import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { embedTexts, toVectorLiteral } from "./embeddings";

export type RetrievedKind = "DOCUMENT" | "KNOWLEDGE" | "MEMORY" | "TASK";

export type ScoreBreakdown = {
  semantic: number;
  keyword: number;
  project: number;
  recency: number;
  entity: number;
  total: number;
};

export type RetrievedItem = {
  id: string;
  kind: RetrievedKind;
  title: string;
  snippet: string;
  source: string;
  sourceRef: string;
  projectId: string | null;
  projectName: string | null;
  timestamp: string | null;
  score: ScoreBreakdown;
  why: string[];
  metadata: Record<string, unknown>;
};

export type HybridSearchOptions = {
  workspaceId: string;
  query: string;
  projectId?: string | null;
  limit?: number;
  entityTerms?: string[];
  includeDocuments?: boolean;
  includeKnowledge?: boolean;
  includeMemory?: boolean;
  includeTasks?: boolean;
  minScore?: number;
};

type VectorRow = { id: string; similarity: number };

async function vectorSearch(table: "DocumentChunk" | "KnowledgeItem" | "Memory", literal: string, workspaceId: string, limit: number, extraWhere: Prisma.Sql) {
  try {
    const rows = await prisma.$queryRaw<VectorRow[]>`
      SELECT id, 1 - (embedding <=> ${literal}::vector) AS similarity
      FROM "${Prisma.raw(table)}"
      WHERE embedding IS NOT NULL ${extraWhere}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${limit}
    `;
    return rows;
  } catch (err) {
    log.warn(`vector search failed on ${table}`, err);
    return [];
  }
}

async function keywordSearch(
  table: "DocumentChunk" | "KnowledgeItem" | "Memory",
  workspaceId: string,
  query: string,
  limit: number,
  textColumn: string,
) {
  try {
    const rows = await prisma.$queryRaw<{ id: string; rank: number }[]>`
      SELECT id, ts_rank(to_tsvector('english', ${Prisma.raw(textColumn)}), websearch_to_tsquery('english', ${query})) AS rank
      FROM "${Prisma.raw(table)}"
      WHERE to_tsvector('english', ${Prisma.raw(textColumn)}) @@ websearch_to_tsquery('english', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;
    return rows;
  } catch (err) {
    log.warn(`keyword search failed on ${table}`, err);
    return [];
  }
}

/**
 * Hybrid retrieval: pgvector cosine similarity + Postgres full-text ranking +
 * metadata (project) + recency + entity overlap. Every returned item carries the
 * score components and a human-readable justification (provenance).
 */
export async function hybridSearch(opts: HybridSearchOptions): Promise<RetrievedItem[]> {
  const {
    workspaceId,
    query,
    projectId = null,
    limit = 12,
    entityTerms = [],
    includeDocuments = true,
    includeKnowledge = true,
    includeMemory = true,
    includeTasks = true,
    minScore = 0.12,
  } = opts;

  const [queryVector] = await embedTexts([query]);
  const literal = toVectorLiteral(queryVector);
  const projectScope = projectId ? Prisma.sql`AND "projectId" = ${projectId}` : Prisma.empty;
  const candidates = new Map<string, Partial<RetrievedItem> & { semantic: number; keyword: number }>();

  const bump = (id: string, patch: Partial<RetrievedItem> & { semantic?: number; keyword?: number }) => {
    const existing = candidates.get(id);
    candidates.set(id, {
      ...existing,
      ...patch,
      semantic: Math.max(existing?.semantic ?? 0, patch.semantic ?? 0),
      keyword: Math.max(existing?.keyword ?? 0, patch.keyword ?? 0),
      score: patch.score ?? existing?.score,
    } as never);
  };

  // ── Documents ─────────────────────────────────────────────────────────────
  if (includeDocuments) {
    const ws = Prisma.sql`AND "documentId" IN (SELECT id FROM "Document" WHERE "workspaceId" = ${workspaceId} ${projectScope})`;
    const [semantic, keyword] = await Promise.all([
      vectorSearch("DocumentChunk", literal, workspaceId, 40, ws),
      keywordSearch("DocumentChunk", workspaceId, query, 40, "content"),
    ]);
    const ids = uniq([...semantic.map((r) => r.id), ...keyword.map((r) => r.id)]).slice(0, 25);
    if (ids.length) {
      const chunks = await prisma.documentChunk.findMany({
        where: { id: { in: ids } },
        include: { document: { select: { id: true, title: true, projectId: true, project: { select: { name: true } }, createdAt: true, workspaceId: true } } },
      });
      const semMap = new Map(semantic.map((r) => [r.id, r.similarity]));
      const kwMap = new Map(keyword.map((r) => [r.id, Math.min(1, r.rank * 4)]));
      for (const chunk of chunks) {
        if (chunk.document.workspaceId !== workspaceId) continue;
        if (projectId && chunk.document.projectId !== projectId) continue;
        bump(chunk.id, {
          id: chunk.id,
          kind: "DOCUMENT",
          title: chunk.document.title,
          snippet: chunk.content.slice(0, 320),
          source: "document",
          sourceRef: `/documents/${chunk.document.id}`,
          projectId: chunk.document.projectId,
          projectName: chunk.document.project?.name ?? null,
          timestamp: chunk.document.createdAt.toISOString(),
          metadata: { documentId: chunk.document.id, page: chunk.page, section: chunk.section, position: chunk.position },
          semantic: semMap.get(chunk.id) ?? 0,
          keyword: kwMap.get(chunk.id) ?? 0,
        });
      }
    }
  }

  // ── Knowledge ─────────────────────────────────────────────────────────────
  if (includeKnowledge) {
    const [semantic, keyword] = await Promise.all([
      vectorSearch("KnowledgeItem", literal, workspaceId, 30, Prisma.sql`AND "workspaceId" = ${workspaceId} ${projectScope}`),
      keywordSearch("KnowledgeItem", workspaceId, query, 30, "content"),
    ]);
    const ids = uniq([...semantic.map((r) => r.id), ...keyword.map((r) => r.id)]).slice(0, 25);
    if (ids.length) {
      const items = await prisma.knowledgeItem.findMany({
        where: { id: { in: ids }, workspaceId },
        include: { project: { select: { name: true } } },
      });
      const semMap = new Map(semantic.map((r) => [r.id, r.similarity]));
      const kwMap = new Map(keyword.map((r) => [r.id, Math.min(1, r.rank * 4)]));
      for (const item of items) {
        if (projectId && item.projectId !== projectId) continue;
        bump(item.id, {
          id: item.id,
          kind: "KNOWLEDGE",
          title: item.label,
          snippet: item.content.slice(0, 320),
          source: "knowledge",
          sourceRef: `/knowledge?q=${encodeURIComponent(item.label)}`,
          projectId: item.projectId,
          projectName: item.project?.name ?? null,
          timestamp: item.updatedAt.toISOString(),
          metadata: { kind: item.kind, confidence: item.confidence },
          semantic: semMap.get(item.id) ?? 0,
          keyword: kwMap.get(item.id) ?? 0,
        });
      }
    }
  }

  // ── Memory ────────────────────────────────────────────────────────────────
  if (includeMemory) {
    const [semantic, keyword] = await Promise.all([
      vectorSearch("Memory", literal, workspaceId, 20, Prisma.sql`AND "workspaceId" = ${workspaceId} AND enabled = true`),
      keywordSearch("Memory", workspaceId, query, 20, "content"),
    ]);
    const ids = uniq([...semantic.map((r) => r.id), ...keyword.map((r) => r.id)]).slice(0, 15);
    if (ids.length) {
      const memories = await prisma.memory.findMany({ where: { id: { in: ids }, workspaceId, enabled: true } });
      const semMap = new Map(semantic.map((r) => [r.id, r.similarity]));
      const kwMap = new Map(keyword.map((r) => [r.id, Math.min(1, r.rank * 4)]));
      await prisma.memory.updateMany({ where: { id: { in: ids } }, data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } } });
      for (const memory of memories) {
        bump(memory.id, {
          id: memory.id,
          kind: "MEMORY",
          title: memory.summary ?? memory.content.slice(0, 60),
          snippet: memory.content.slice(0, 240),
          source: "memory",
          sourceRef: `/memory?q=${encodeURIComponent(memory.id)}`,
          projectId: memory.projectId,
          projectName: null,
          timestamp: memory.updatedAt.toISOString(),
          metadata: { type: memory.type, importance: memory.importance, confidence: memory.confidence },
          semantic: semMap.get(memory.id) ?? 0,
          keyword: kwMap.get(memory.id) ?? 0,
        });
      }
    }
  }

  // ── Tasks (lexical + metadata; no embeddings) ─────────────────────────────
  if (includeTasks) {
    const tasks = await prisma.task.findMany({
      where: {
        workspaceId,
        ...(projectId ? { projectId } : {}),
        OR: queryTerms(query).slice(0, 6).map((t) => ({ title: { contains: t, mode: "insensitive" as const } })),
      },
      take: 12,
      include: { project: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    });
    for (const task of tasks) {
      bump(task.id, {
        id: task.id,
        kind: "TASK",
        title: task.title,
        snippet: task.description ?? `Status: ${task.status} · Priority: ${task.priority}`,
        source: "task",
        sourceRef: `/tasks?task=${task.id}`,
        projectId: task.projectId,
        projectName: task.project?.name ?? null,
        timestamp: task.updatedAt.toISOString(),
        metadata: { status: task.status, priority: task.priority, dueDate: task.dueDate?.toISOString() ?? null },
        semantic: 0,
        keyword: lexicalOverlap(query, `${task.title} ${task.description ?? ""}`),
      });
    }
  }

  const now = Date.now();
  const scored: RetrievedItem[] = [];

  for (const candidate of candidates.values()) {
    const semantic = candidate.semantic ?? 0;
    const keyword = candidate.keyword ?? 0;
    const project = projectId && candidate.projectId === projectId ? 1 : candidate.projectId ? 0.35 : 0;
    const recency = recencyScore(candidate.timestamp ?? null, now);
    const entity = entityScore(query, `${candidate.title ?? ""} ${candidate.snippet ?? ""}`, entityTerms);

    const total = Number(
      (
        semantic * 0.4 +
        keyword * 0.3 +
        project * 0.12 +
        recency * 0.08 +
        entity * 0.1
      ).toFixed(4),
    );

    if (total < minScore) continue;

    const why: string[] = [];
    if (semantic > 0.3) why.push(`Semantic match (cosine ${semantic.toFixed(2)})`);
    if (keyword > 0.2) why.push(`Keyword relevance (${keyword.toFixed(2)})`);
    if (project === 1) why.push("Belongs to the active project");
    if (recency > 0.6) why.push("Recent activity");
    if (entity > 0.3) why.push("Shares entities with the request");

    scored.push({
      id: candidate.id!,
      kind: candidate.kind!,
      title: candidate.title ?? "Untitled",
      snippet: candidate.snippet ?? "",
      source: candidate.source ?? "workspace",
      sourceRef: candidate.sourceRef ?? "/",
      projectId: candidate.projectId ?? null,
      projectName: candidate.projectName ?? null,
      timestamp: candidate.timestamp ?? null,
      score: { semantic: r(semantic), keyword: r(keyword), project: r(project), recency: r(recency), entity: r(entity), total },
      why: why.length ? why : ["Matched by lexical signal only"],
      metadata: candidate.metadata ?? {},
    });
  }

  scored.sort((a, b) => b.score.total - a.score.total);
  return scored.slice(0, limit);
}

function r(n: number) {
  return Number(n.toFixed(3));
}

function recencyScore(iso: string | null, now: number) {
  if (!iso) return 0.3;
  const ageDays = (now - new Date(iso).getTime()) / 86_400_000;
  return Number(Math.max(0, Math.exp(-ageDays / 21)).toFixed(4));
}

function entityScore(query: string, text: string, extraTerms: string[]) {
  const q = new Set([...queryTerms(query), ...extraTerms.map((t) => t.toLowerCase())]);
  if (!q.size) return 0;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const term of q) if (lower.includes(term)) hits += 1;
  return Number(Math.min(1, hits / q.size).toFixed(4));
}

function queryTerms(query: string) {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    ),
  );
}

function lexicalOverlap(query: string, text: string) {
  const q = queryTerms(query);
  if (!q.length) return 0;
  const lower = text.toLowerCase();
  const hits = q.filter((t) => lower.includes(t)).length;
  return Number(Math.min(1, hits / q.length).toFixed(4));
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export type { RetrievedItem as HybridResult };
