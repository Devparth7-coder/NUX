import { prisma } from "@/lib/db";
import { hybridSearch, type RetrievedItem } from "./hybrid";
import { log } from "@/lib/logger";

export type ContextBundle = {
  query: string;
  items: RetrievedItem[];
  project: { id: string; name: string; objective: string | null; health: string; progress: number } | null;
  openTasks: Array<{ id: string; title: string; status: string; priority: string; dueDate: string | null }>;
  documents: Array<{ id: string; title: string; status: string; chunkCount: number }>;
  memories: Array< { id: string; content: string; type: string; importance: number } >;
  confidence: number;
  sources: Array<{ label: string; count: number }>;
  generatedAt: string;
};

/**
 * Context Engine — decides what NEXUS must know before it acts.
 * No context item is ever invented: everything below is read from Postgres and
 * carries provenance (source, score components and a "why selected" rationale).
 */
export async function buildContext(args: {
  workspaceId: string;
  query: string;
  projectId?: string | null;
  limit?: number;
  entityTerms?: string[];
  userId?: string;
}): Promise<ContextBundle> {
  const { workspaceId, query, projectId = null, limit = 12, entityTerms = [], userId } = args;

  const [items, project, openTasks, documents, memories] = await Promise.all([
    hybridSearch({ workspaceId, query, projectId, limit, entityTerms }),
    projectId
      ? prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true, name: true, objective: true, health: true, progress: true } })
      : Promise.resolve(null),
    prisma.task.findMany({
      where: { workspaceId, ...(projectId ? { projectId } : {}), status: { not: "DONE" } },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 12,
      select: { id: true, title: true, status: true, priority: true, dueDate: true },
    }),
    prisma.document.findMany({
      where: { workspaceId, ...(projectId ? { projectId } : {}), status: "INDEXED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, status: true, chunkCount: true },
    }),
    prisma.memory.findMany({
      where: { workspaceId, enabled: true, ...(projectId ? { OR: [{ projectId }, { scope: "USER" }] } : {}), ...(userId ? {} : {}) },
      orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
      take: 8,
      select: { id: true, content: true, type: true, importance: true },
    }),
  ]);

  const sources = aggregateSources(items);
  const confidence = computeConfidence(items, openTasks.length, documents.length);

  log.debug(`context built: ${items.length} items, confidence ${confidence}`);

  return {
    query,
    items,
    project: project ? { ...project, objective: project.objective } : null,
    openTasks: openTasks.map((t) => ({ ...t, dueDate: t.dueDate?.toISOString() ?? null })),
    documents,
    memories,
    confidence,
    sources,
    generatedAt: new Date().toISOString(),
  };
}

function aggregateSources(items: RetrievedItem[]) {
  const map = new Map<string, number>();
  for (const item of items) map.set(item.source, (map.get(item.source) ?? 0) + 1);
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function computeConfidence(items: RetrievedItem[], taskCount: number, docCount: number) {
  if (!items.length) return 0;
  const top = items.slice(0, 5);
  const mean = top.reduce((a, i) => a + i.score.total, 0) / top.length;
  const coverage = Math.min(1, (items.length + taskCount * 0.25 + docCount * 0.15) / 12);
  return Number(Math.min(0.98, mean * 0.7 + coverage * 0.3).toFixed(3));
}
