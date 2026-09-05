/**
 * Global search (§19): semantic + keyword across projects, documents, tasks,
 * knowledge, memory, conversations, agents and activity.
 */

import { prisma } from '../db';
import { hybridSearchChunks, hybridSearchKnowledge } from './search';
import { searchMemory } from '../memory/service';

export type SearchResultType =
  | 'PROJECT' | 'DOCUMENT' | 'TASK' | 'KNOWLEDGE' | 'MEMORY' | 'CONVERSATION' | 'AGENT' | 'ACTIVITY';

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  snippet: string;
  relevance: number;
  projectId: string | null;
  projectName: string | null;
  timestamp: Date | null;
  source: string;
  href: string | null;
}

export async function globalSearch(options: {
  workspaceId: string;
  userId: string;
  query: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const { workspaceId, userId, query } = options;
  const limit = options.limit ?? 8;
  if (query.trim().length < 2) return [];
  const lower = query.toLowerCase();

  const results: SearchResult[] = [];

  const [projects, tasks, conversations, activities, agents] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId }, take: 100 }),
    prisma.task.findMany({ where: { workspaceId }, take: 300, include: { project: { select: { name: true } } } }),
    prisma.conversation.findMany({ where: { userId }, take: 60 }),
    prisma.activity.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.agent.findMany({ take: 20 }),
  ]);

  for (const project of projects) {
    const haystack = `${project.name} ${project.objective ?? ''} ${project.summary ?? ''} ${project.description ?? ''}`.toLowerCase();
    if (!haystack.includes(lower)) continue;
    const relevance = project.name.toLowerCase().includes(lower) ? 0.95 : 0.6;
    results.push({
      id: project.id, type: 'PROJECT', title: project.name,
      snippet: (project.objective ?? project.summary ?? project.description ?? '').slice(0, 200),
      relevance, projectId: project.id, projectName: project.name,
      timestamp: project.updatedAt, source: 'projects', href: `/projects/${project.id}`,
    });
  }

  for (const task of tasks) {
    const haystack = `${task.title} ${task.description ?? ''}`.toLowerCase();
    if (!haystack.includes(lower)) continue;
    results.push({
      id: task.id, type: 'TASK', title: task.title,
      snippet: (task.description ?? `Status: ${task.status} · Priority: ${task.priority}`).slice(0, 200),
      relevance: task.title.toLowerCase().includes(lower) ? 0.9 : 0.55,
      projectId: task.projectId, projectName: task.project?.name ?? null,
      timestamp: task.updatedAt, source: 'tasks', href: '/tasks',
    });
  }

  const chunks = await hybridSearchChunks({ workspaceId, query, limit });
  const seenDocs = new Set<string>();
  for (const chunk of chunks) {
    if (seenDocs.has(chunk.documentId)) continue;
    seenDocs.add(chunk.documentId);
    results.push({
      id: chunk.documentId, type: 'DOCUMENT', title: chunk.documentTitle,
      snippet: chunk.content.slice(0, 220),
      relevance: chunk.scores.relevance,
      projectId: chunk.projectId, projectName: null,
      timestamp: chunk.updatedAt, source: 'document chunks', href: `/documents/${chunk.documentId}`,
    });
  }

  const knowledge = await hybridSearchKnowledge({ workspaceId, query, limit });
  for (const item of knowledge) {
    results.push({
      id: item.id, type: 'KNOWLEDGE', title: item.title,
      snippet: item.content.slice(0, 200), relevance: item.scores.relevance,
      projectId: item.projectId, projectName: null,
      timestamp: null, source: 'knowledge graph', href: '/knowledge',
    });
  }

  const memories = await searchMemory({ workspaceId, userId, query, limit });
  for (const hit of memories) {
    results.push({
      id: hit.memory.id, type: 'MEMORY', title: hit.memory.content.slice(0, 80),
      snippet: hit.memory.content.slice(0, 200), relevance: hit.score,
      projectId: hit.memory.projectId, projectName: null,
      timestamp: hit.memory.updatedAt, source: `memory (${hit.memory.type.toLowerCase()})`, href: '/memory',
    });
  }

  for (const conversation of conversations) {
    if (!conversation.title.toLowerCase().includes(lower)) continue;
    results.push({
      id: conversation.id, type: 'CONVERSATION', title: conversation.title,
      snippet: (conversation.summary ?? '').slice(0, 160) || 'Conversation',
      relevance: 0.7, projectId: conversation.projectId, projectName: null,
      timestamp: conversation.updatedAt, source: 'conversations', href: `/command?conversation=${conversation.id}`,
    });
  }

  for (const activity of activities) {
    const haystack = `${activity.action} ${activity.summary}`.toLowerCase();
    if (!haystack.includes(lower)) continue;
    results.push({
      id: activity.id, type: 'ACTIVITY', title: activity.action,
      snippet: activity.summary.slice(0, 180), relevance: 0.5,
      projectId: activity.projectId, projectName: null,
      timestamp: activity.createdAt, source: 'activity', href: '/activity',
    });
  }

  for (const agent of agents) {
    const haystack = `${agent.name} ${agent.description}`.toLowerCase();
    if (!haystack.includes(lower)) continue;
    results.push({
      id: agent.id, type: 'AGENT', title: agent.name,
      snippet: agent.description, relevance: 0.65,
      projectId: null, projectName: null, timestamp: agent.updatedAt,
      source: 'agents', href: '/agents',
    });
  }

  return results.sort((a, b) => b.relevance - a.relevance).slice(0, 40);
}
