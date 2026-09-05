/**
 * Memory architecture (§8) — four layers with lifecycle management.
 *
 *   SHORT_TERM : session/conversation scoped, short TTL
 *   PROJECT    : facts and decisions tied to a project
 *   LONG_TERM  : durable user preferences and useful history
 *   EXPLICIT   : facts the user saved on purpose (never auto-pruned)
 *
 * Lifecycle: memory is not a dumping ground. `enforceLifecycle()` prunes low
 * importance, unpinned, stale entries once a workspace exceeds its budget.
 */

import type { Memory, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { embedLocal, EMBED_DIMENSIONS, cosineSimilarity, deserializeEmbedding, serializeEmbedding } from '../retrieval/embed';
import { bm25Score } from '../retrieval/bm25';
import { hybridScore, recencyScore } from '../retrieval/hybrid';

export type MemoryType = 'SHORT_TERM' | 'PROJECT' | 'LONG_TERM' | 'EXPLICIT' | 'EPISODIC';

export const MEMORY_TYPES: MemoryType[] = ['SHORT_TERM', 'PROJECT', 'LONG_TERM', 'EXPLICIT', 'EPISODIC'];

const WORKSPACE_MEMORY_BUDGET = 500;
const SHORT_TERM_TTL_DAYS = 3;

export interface MemorySearchOptions {
  workspaceId: string;
  query: string;
  userId?: string;
  projectId?: string | null;
  types?: MemoryType[];
  limit?: number;
}

export interface MemorySearchHit {
  memory: Memory;
  score: number;
  breakdown: { semantic: number; keyword: number; recency: number; importance: number };
}

/** Hybrid memory retrieval: semantic + keyword + recency + importance. */
export async function searchMemory(options: MemorySearchOptions): Promise<MemorySearchHit[]> {
  const { workspaceId, query, limit = 6, projectId, types } = options;
  const rows = await prisma.memory.findMany({
    where: {
      workspaceId,
      enabled: true,
      ...(types?.length ? { type: { in: types } } : {}),
      ...(projectId ? { OR: [{ projectId }, { projectId: null }] } : {}),
    },
    take: 400,
    orderBy: { updatedAt: 'desc' },
  });
  if (!rows.length) return [];

  const queryVec = embedLocal(query, EMBED_DIMENSIONS);
  const keyword = new Map(
    bm25Score(query, rows.map((r) => ({ id: r.id, text: r.content }))).map((s) => [s.id, s.score]),
  );

  const hits: MemorySearchHit[] = rows.map((memory) => {
    const vec = deserializeEmbedding(memory.embedding);
    const semantic = vec ? Math.max(0, cosineSimilarity(queryVec, vec)) : 0;
    const recency = recencyScore(memory.updatedAt, Date.now(), 30);
    const importance = memory.importance / 100;
    const score = hybridScore({
      semantic,
      keyword: keyword.get(memory.id) ?? 0,
      project: projectId && memory.projectId === projectId ? 1 : 0.3,
      recency,
      entity: importance,
    });
    return { memory, score, breakdown: { semantic, keyword: keyword.get(memory.id) ?? 0, recency, importance } };
  });

  const results = hits.filter((h) => h.score > 0.05).sort((a, b) => b.score - a.score).slice(0, limit);

  if (results.length) {
    await prisma.memory.updateMany({
      where: { id: { in: results.map((r) => r.memory.id) } },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
    });
  }

  return results;
}

export interface WriteMemoryInput {
  workspaceId: string;
  userId: string;
  content: string;
  type: MemoryType;
  source?: string;
  sourceRunId?: string;
  confidence?: number;
  importance?: number;
  projectId?: string | null;
  scope?: 'SESSION' | 'PROJECT' | 'WORKSPACE' | 'USER';
  tags?: string[];
  pinned?: boolean;
}

/**
 * Persist a memory. Near-duplicates update the existing record instead of
 * accumulating — this is the "avoid storing everything" rule, enforced in code.
 */
export async function writeMemory(input: WriteMemoryInput): Promise<{ memory: Memory; deduped: boolean }> {
  const vector = embedLocal(input.content, EMBED_DIMENSIONS);
  const candidates = await prisma.memory.findMany({
    where: { workspaceId: input.workspaceId, type: input.type },
    orderBy: { updatedAt: 'desc' },
    take: 150,
  });

  for (const candidate of candidates) {
    const vec = deserializeEmbedding(candidate.embedding);
    if (vec && cosineSimilarity(vector, vec) > 0.93) {
      const updated = await prisma.memory.update({
        where: { id: candidate.id },
        data: {
          content: input.content.length > candidate.content.length ? input.content : candidate.content,
          importance: Math.max(candidate.importance, input.importance ?? candidate.importance),
          lastAccessedAt: new Date(),
          updatedAt: new Date(),
          tags: input.tags?.length ? JSON.stringify(input.tags) : candidate.tags,
        },
      });
      return { memory: updated, deduped: true };
    }
  }

  const memory = await prisma.memory.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId ?? null,
      type: input.type,
      content: input.content,
      source: input.source ?? 'AGENT',
      sourceRunId: input.sourceRunId ?? null,
      confidence: input.confidence ?? 0.8,
      importance: input.importance ?? 50,
      scope: input.scope ?? (input.projectId ? 'PROJECT' : 'WORKSPACE'),
      tags: JSON.stringify(input.tags ?? []),
      pinned: input.pinned ?? false,
      embedding: serializeEmbedding(vector),
    },
  });
  return { memory, deduped: false };
}

export function updateMemory(id: string, data: Prisma.MemoryUpdateInput) {
  return prisma.memory.update({ where: { id }, data });
}

export function deleteMemory(id: string) {
  return prisma.memory.delete({ where: { id } });
}

export function toggleMemory(id: string, enabled: boolean) {
  return prisma.memory.update({ where: { id }, data: { enabled } });
}

export async function listMemories(filters: {
  workspaceId: string;
  userId?: string;
  type?: MemoryType;
  projectId?: string;
  query?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Prisma.MemoryWhereInput = {
    workspaceId: filters.workspaceId,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.query ? { content: { contains: filters.query } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.memory.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { importance: 'desc' }, { updatedAt: 'desc' }],
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
    }),
    prisma.memory.count({ where }),
  ]);
  return { items, total };
}

/**
 * Lifecycle enforcement. Keeps memory useful instead of unbounded:
 *  1. expire short-term memories past their TTL
 *  2. if over budget, prune the least valuable non-pinned, non-explicit entries
 */
export async function enforceLifecycle(workspaceId: string): Promise<{ expired: number; pruned: number }> {
  const ttl = new Date(Date.now() - SHORT_TERM_TTL_DAYS * 86_400_000);
  const expiredResult = await prisma.memory.deleteMany({
    where: { workspaceId, type: 'SHORT_TERM', pinned: false, lastAccessedAt: { lt: ttl } },
  });

  const total = await prisma.memory.count({ where: { workspaceId } });
  let pruned = 0;
  if (total > WORKSPACE_MEMORY_BUDGET) {
    const excess = total - WORKSPACE_MEMORY_BUDGET;
    const prunable = await prisma.memory.findMany({
      where: { workspaceId, pinned: false, type: { not: 'EXPLICIT' } },
      orderBy: [{ importance: 'asc' }, { accessCount: 'asc' }, { updatedAt: 'asc' }],
      take: excess,
      select: { id: true },
    });
    if (prunable.length) {
      const result = await prisma.memory.deleteMany({ where: { id: { in: prunable.map((p) => p.id) } } });
      pruned = result.count;
    }
  }
  return { expired: expiredResult.count, pruned };
}

export interface MemoryCandidate {
  content: string;
  type: MemoryType;
  importance: number;
  confidence?: number;
  projectId?: string | null;
}

/**
 * Extract durable facts from a completed run. Only high-signal facts are kept:
 * the objective, decisions taken, and the outcome — never transient chatter.
 */
export function deriveMemoryCandidates(input: {
  intent: { objective: string; deadlineText: string | null; projectContext: string | null; rawInput: string };
  projectName: string | null;
  taskTitles: string[];
  approvals: { title: string; status: string }[];
}): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  const { intent, projectName, taskTitles, approvals } = input;

  candidates.push({
    content: `User objective: ${intent.objective}${intent.deadlineText ? ` (deadline: ${intent.deadlineText})` : ''}.`,
    type: 'PROJECT',
    importance: 72,
    confidence: 0.9,
    projectId: intent.projectContext,
  });

  if (projectName) {
    candidates.push({
      content: `Active project focus: ${projectName}.`,
      type: 'LONG_TERM',
      importance: 65,
      confidence: 0.85,
    });
  }

  if (taskTitles.length) {
    candidates.push({
      content: `Launch work items created: ${taskTitles.slice(0, 6).join('; ')}.`,
      type: 'PROJECT',
      importance: 58,
      confidence: 0.9,
      projectId: intent.projectContext,
    });
  }

  for (const approval of approvals) {
    if (approval.status === 'DENIED') {
      candidates.push({
        content: `User declined: ${approval.title}. Avoid proposing this again without being asked.`,
        type: 'LONG_TERM',
        importance: 70,
        confidence: 0.8,
      });
    }
  }

  return candidates;
}
