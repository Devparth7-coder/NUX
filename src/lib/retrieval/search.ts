/**
 * Hybrid retrieval over document chunks and knowledge items (§7, §15).
 *
 * Real pipeline: embed the query → cosine over indexed vectors → BM25 over the
 * same candidate text → blend with project / recency / entity signals →
 * normalise → attach an explanation for every returned item.
 *
 * Nothing is returned that is not in the database, and every row carries the
 * document it came from.
 */

import { prisma } from '../db';
import {
  EMBED_DIMENSIONS,
  cosineSimilarity,
  deserializeEmbedding,
  embedLocal,
} from './embed';
import { bm25Score } from './bm25';
import { entityScore, explain, hybridScore, recencyScore } from './hybrid';

export interface ChunkHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  projectId: string | null;
  content: string;
  page: number;
  section: string | null;
  position: number;
  scores: { semantic: number; keyword: number; project: number; recency: number; entity: number; relevance: number };
  rationale: string;
  updatedAt: Date;
}

export interface SearchOptions {
  workspaceId: string;
  query: string;
  projectId?: string | null;
  limit?: number;
  entityNames?: string[];
}

const MAX_CANDIDATES = 4000;

export async function hybridSearchChunks(options: SearchOptions): Promise<ChunkHit[]> {
  const { workspaceId, query, projectId, limit = 8, entityNames = [] } = options;

  const chunks = await prisma.documentChunk.findMany({
    where: {
      document: {
        workspaceId,
        ...(projectId ? { projectId } : {}),
      },
    },
    select: {
      id: true,
      documentId: true,
      content: true,
      page: true,
      section: true,
      position: true,
      embedding: true,
      createdAt: true,
      document: { select: { title: true, projectId: true, updatedAt: true } },
    },
    take: MAX_CANDIDATES,
    orderBy: { createdAt: 'desc' },
  });

  if (!chunks.length) return [];

  const queryVec = embedLocal(query, EMBED_DIMENSIONS);
  const keyword = new Map(
    bm25Score(query, chunks.map((c) => ({ id: c.id, text: c.content }))).map((s) => [s.id, s.score]),
  );

  const scored: ChunkHit[] = chunks.map((chunk) => {
    const vec = deserializeEmbedding(chunk.embedding);
    const semantic = vec ? Math.max(0, cosineSimilarity(queryVec, vec)) : 0;
    const kw = keyword.get(chunk.id) ?? 0;
    const project =
      projectId && chunk.document.projectId === projectId ? 1 : chunk.document.projectId ? 0.35 : 0.15;
    const recency = recencyScore(chunk.document.updatedAt);
    const entity = entityScore(entityNames, chunk.content);
    const scores = { semantic, keyword: kw, project, recency, entity, relevance: 0 };
    scores.relevance = hybridScore(scores);
    return {
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: chunk.document.title,
      projectId: chunk.document.projectId,
      content: chunk.content,
      page: chunk.page,
      section: chunk.section,
      position: chunk.position,
      scores,
      rationale: explain(scores),
      updatedAt: chunk.document.updatedAt,
    };
  });

  return scored
    .filter((hit) => hit.scores.relevance > 0.02)
    .sort((a, b) => b.scores.relevance - a.scores.relevance)
    .slice(0, limit);
}

export interface KnowledgeHit {
  id: string;
  title: string;
  content: string;
  type: string;
  projectId: string | null;
  confidence: number;
  scores: { semantic: number; keyword: number; project: number; recency: number; entity: number; relevance: number };
  rationale: string;
}

export async function hybridSearchKnowledge(options: SearchOptions): Promise<KnowledgeHit[]> {
  const { workspaceId, query, projectId, limit = 6, entityNames = [] } = options;
  const items = await prisma.knowledgeItem.findMany({
    where: { workspaceId, ...(projectId ? { projectId } : {}) },
    take: 1000,
  });
  if (!items.length) return [];

  const queryVec = embedLocal(query, EMBED_DIMENSIONS);
  const keyword = new Map(
    bm25Score(
      query,
      items.map((i) => ({ id: i.id, text: `${i.title} ${i.summary ?? ''} ${i.content ?? ''}` })),
    ).map((s) => [s.id, s.score]),
  );

  return items
    .map((item) => {
      const vec = deserializeEmbedding(item.embedding);
      const semantic = vec ? Math.max(0, cosineSimilarity(queryVec, vec)) : 0;
      const project = projectId && item.projectId === projectId ? 1 : item.projectId ? 0.4 : 0.2;
      const recency = recencyScore(item.updatedAt);
      const entity = entityScore(entityNames, `${item.title} ${item.content ?? ''}`);
      const scores = {
        semantic,
        keyword: keyword.get(item.id) ?? 0,
        project,
        recency,
        entity,
        relevance: 0,
      };
      scores.relevance = hybridScore(scores);
      return {
        id: item.id,
        title: item.title,
        content: item.summary ?? item.content ?? '',
        type: item.type,
        projectId: item.projectId,
        confidence: item.confidence,
        scores,
        rationale: explain(scores),
      };
    })
    .filter((hit) => hit.scores.relevance > 0.02)
    .sort((a, b) => b.scores.relevance - a.scores.relevance)
    .slice(0, limit);
}
