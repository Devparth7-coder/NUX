/**
 * Context Engine (§7).
 *
 * Determines what NEXUS needs to know before acting, using hybrid retrieval over
 * every context source: projects, documents (chunk-level), tasks, knowledge,
 * memory, conversations, decisions, activity and integrations.
 *
 * Rules enforced here:
 *  • Every returned item is a real database row. Nothing is synthesised.
 *  • Every item carries a score breakdown and a "why selected" rationale.
 *  • Results are persisted as ContextItem rows so a run's grounding is auditable.
 */

import type { ContextBundle, ContextSourceType, IntentObject, RetrievedContextItem } from '@/types';
import { prisma } from '../db';
import { hybridSearchChunks, hybridSearchKnowledge } from './search';
import { entityScore, explain, hybridScore, recencyScore } from './hybrid';
import { embedLocal, EMBED_DIMENSIONS } from './embed';
import { bm25Score } from './bm25';

export interface ContextEngineInput {
  workspaceId: string;
  userId: string;
  intent: IntentObject;
  rawInput: string;
  intentId: string;
  limit?: number;
  persist?: boolean;
}

interface Candidate {
  sourceType: ContextSourceType;
  sourceId: string;
  title: string;
  snippet: string;
  projectId: string | null;
  createdAt: Date | null;
  metadata?: Record<string, unknown>;
  text: string;
}

const DEFAULT_LIMIT = 12;

export async function buildContext(input: ContextEngineInput): Promise<ContextBundle> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const projectId = input.intent.projectContext ?? null;
  const entityNames = input.intent.entities.map((e) => e.name);
  const intentProjectId = projectId;

  const candidates: Candidate[] = [];

  // ── Projects ──────────────────────────────────────────────────────────────
  const projects = await prisma.project.findMany({
    where: { workspaceId: input.workspaceId },
    include: { _count: { select: { tasks: true, documents: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  });
  for (const p of projects) {
    candidates.push({
      sourceType: 'PROJECT',
      sourceId: p.id,
      title: p.name,
      snippet: [p.objective, p.summary, p.description].filter(Boolean).join(' — ').slice(0, 400) || 'No summary yet.',
      projectId: p.id,
      createdAt: p.updatedAt,
      text: `${p.name} ${p.objective ?? ''} ${p.summary ?? ''} ${p.description ?? ''} ${p.health} ${p.status}`,
      metadata: { health: p.health, progress: p.progress, tasks: p._count.tasks, documents: p._count.documents },
    });
  }

  // ── Document chunks (semantic + keyword, the heavy lifter) ────────────────
  const chunks = await hybridSearchChunks({
    workspaceId: input.workspaceId,
    query: input.rawInput,
    projectId,
    limit: 10,
    entityNames,
  });
  for (const hit of chunks) {
    candidates.push({
      sourceType: 'DOCUMENT_CHUNK',
      sourceId: hit.chunkId,
      title: `${hit.documentTitle}${hit.section ? ` — ${hit.section}` : ''}`,
      snippet: hit.content.slice(0, 400),
      projectId: hit.projectId,
      createdAt: hit.updatedAt,
      text: hit.content,
      metadata: { documentId: hit.documentId, page: hit.page, section: hit.section, scores: hit.scores, why: hit.rationale },
    });
  }

  // ── Documents (document-level signal) ─────────────────────────────────────
  const docs = await prisma.document.findMany({
    where: { workspaceId: input.workspaceId, status: 'INDEXED' },
    orderBy: { updatedAt: 'desc' },
    take: 60,
    select: { id: true, title: true, summary: true, projectId: true, updatedAt: true, wordCount: true, chunkCount: true },
  });
  for (const d of docs) {
    candidates.push({
      sourceType: 'DOCUMENT',
      sourceId: d.id,
      title: d.title,
      snippet: (d.summary ?? `${d.wordCount} words indexed across ${d.chunkCount} chunks`).slice(0, 400),
      projectId: d.projectId,
      createdAt: d.updatedAt,
      text: `${d.title} ${d.summary ?? ''}`,
      metadata: { wordCount: d.wordCount, chunkCount: d.chunkCount },
    });
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  const tasks = await prisma.task.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(projectId ? { projectId } : {}),
      status: { not: 'DONE' },
    },
    orderBy: [{ deadline: 'asc' }, { updatedAt: 'desc' }],
    take: 80,
    select: { id: true, title: true, description: true, status: true, priority: true, deadline: true, projectId: true, updatedAt: true },
  });
  for (const t of tasks) {
    candidates.push({
      sourceType: 'TASK',
      sourceId: t.id,
      title: t.title,
      snippet: (t.description ?? `Status ${t.status} · priority ${t.priority}`).slice(0, 300),
      projectId: t.projectId,
      createdAt: t.updatedAt,
      text: `${t.title} ${t.description ?? ''} ${t.status} ${t.priority}`,
      metadata: { status: t.status, priority: t.priority, deadline: t.deadline },
    });
  }

  // ── Knowledge graph ───────────────────────────────────────────────────────
  const knowledge = await hybridSearchKnowledge({
    workspaceId: input.workspaceId,
    query: input.rawInput,
    projectId,
    limit: 8,
    entityNames,
  });
  for (const k of knowledge) {
    candidates.push({
      sourceType: 'KNOWLEDGE',
      sourceId: k.id,
      title: `${k.type}: ${k.title}`,
      snippet: k.content.slice(0, 300),
      projectId: k.projectId,
      createdAt: new Date(),
      text: `${k.title} ${k.content}`,
      metadata: { type: k.type, confidence: k.confidence },
    });
  }

  // ── Memory ────────────────────────────────────────────────────────────────
  const memories = await prisma.memory.findMany({
    where: {
      workspaceId: input.workspaceId,
      enabled: true,
      ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}),
    },
    orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
    take: 40,
  });
  for (const m of memories) {
    candidates.push({
      sourceType: 'MEMORY',
      sourceId: m.id,
      title: `${m.type.replace('_', ' ')} memory`,
      snippet: m.content.slice(0, 300),
      projectId: m.projectId,
      createdAt: m.updatedAt,
      text: `${m.content} ${m.type}`,
      metadata: { confidence: m.confidence, importance: m.importance, pinned: m.pinned },
    });
  }

  // ── Recent activity (what has been happening) ─────────────────────────────
  const activities = await prisma.activity.findMany({
    where: { workspaceId: input.workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  for (const a of activities) {
    candidates.push({
      sourceType: 'ACTIVITY',
      sourceId: a.id,
      title: a.action,
      snippet: a.summary.slice(0, 240),
      projectId: a.projectId,
      createdAt: a.createdAt,
      text: `${a.action} ${a.summary}`,
      metadata: { type: a.type, severity: a.severity },
    });
  }

  // ── Score every candidate ─────────────────────────────────────────────────
  const queryVec = embedLocal(input.rawInput, EMBED_DIMENSIONS);
  const keyword = new Map(
    bm25Score(input.rawInput, candidates.map((c, i) => ({ id: String(i), text: c.text }))).map((s) => [s.id, s.score]),
  );

  const scored: (RetrievedContextItem & { index: number })[] = candidates.map((c, index) => {
    const semanticRaw = chunkSemantic(c, queryVec);
    const scores = {
      semantic: semanticRaw,
      keyword: keyword.get(String(index)) ?? 0,
      project: intentProjectId ? (c.projectId === intentProjectId ? 1 : 0.25) : c.projectId ? 0.4 : 0.2,
      recency: recencyScore(c.createdAt),
      entity: entityScore(entityNames, c.text),
      relevance: 0,
    };
    scores.relevance = hybridScore(scores);
    const rationale =
      (c.metadata?.why as string | undefined) ?? explain(scores);
    return {
      index,
      sourceType: c.sourceType,
      sourceId: c.sourceId,
      title: c.title,
      snippet: c.snippet,
      scores,
      rationale,
      metadata: c.metadata,
      createdAt: c.createdAt ?? undefined,
    };
  });

  const items = scored
    .filter((item) => item.scores.relevance > 0.03)
    .sort((a, b) => b.scores.relevance - a.scores.relevance)
    .slice(0, limit)
    .map(({ index: _index, ...item }) => item);

  if (input.persist !== false && items.length) {
    await prisma.contextItem.createMany({
      data: items.map((item) => ({
        intentId: input.intentId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        title: item.title,
        snippet: item.snippet,
        semantic: item.scores.semantic,
        keyword: item.scores.keyword,
        projectScore: item.scores.project,
        recency: item.scores.recency,
        entityScore: item.scores.entity,
        relevance: item.scores.relevance,
        rationale: item.rationale,
      })),
    });
  }

  // Touch memory access metadata for the memories that were actually used.
  const usedMemoryIds = items.filter((i) => i.sourceType === 'MEMORY').map((i) => i.sourceId);
  if (usedMemoryIds.length) {
    await prisma.memory.updateMany({
      where: { id: { in: usedMemoryIds } },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
    });
  }

  const counts: Record<string, number> = {};
  for (const item of items) counts[item.sourceType] = (counts[item.sourceType] ?? 0) + 1;

  const confidence = items.length
    ? Number(Math.min(0.99, items.slice(0, 5).reduce((sum, i) => sum + i.scores.relevance, 0) / 5).toFixed(3))
    : 0;

  return {
    items,
    query: input.rawInput,
    confidence,
    sources: [...new Set(items.map((i) => i.sourceType))],
    retrievedAt: new Date(),
    counts,
  };
}

/** Document chunks already carry a precomputed semantic score — reuse it. */
function chunkSemantic(candidate: Candidate, queryVec: Float32Array): number {
  if (candidate.sourceType === 'DOCUMENT_CHUNK') {
    const precomputed = (candidate.metadata?.scores as { semantic?: number } | undefined)?.semantic;
    if (typeof precomputed === 'number') return precomputed;
  }
  if (candidate.sourceType === 'KNOWLEDGE') {
    const precomputed = (candidate.metadata?.scores as { semantic?: number } | undefined)?.semantic;
    if (typeof precomputed === 'number') return precomputed;
  }
  const vec = embedLocal(candidate.text, EMBED_DIMENSIONS);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < vec.length; i++) {
    dot += vec[i] * queryVec[i];
    na += vec[i] * vec[i];
    nb += queryVec[i] * queryVec[i];
  }
  if (!na || !nb) return 0;
  return Math.max(0, dot / (Math.sqrt(na) * Math.sqrt(nb)));
}
