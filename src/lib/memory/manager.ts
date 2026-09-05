import type { MemoryScope, MemoryType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { embedTexts } from "@/lib/retrieval/embeddings";
import { storeVector } from "@/lib/retrieval/vector-store";
import { log } from "@/lib/logger";

export type SaveMemoryInput = {
  workspaceId: string;
  userId?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  content: string;
  summary?: string | null;
  type: MemoryType;
  scope: MemoryScope;
  importance?: number;
  confidence?: number;
  source?: string;
  tags?: string[];
  expiresAt?: Date | null;
};

/**
 * Memory lifecycle: only durable, high-signal facts are stored.
 * Short-term session memories expire automatically; project memories are scoped.
 */
export async function saveMemory(input: SaveMemoryInput) {
  const content = input.content.trim();
  if (content.length < 12) return null;

  const duplicate = await prisma.memory.findFirst({
    where: { workspaceId: input.workspaceId, content, enabled: true },
    select: { id: true },
  });
  if (duplicate) {
    await prisma.memory.update({
      where: { id: duplicate.id },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 }, importance: Math.max(0.5, input.importance ?? 0.5) },
    });
    return duplicate.id;
  }

  const memory = await prisma.memory.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      projectId: input.projectId ?? null,
      conversationId: input.conversationId ?? null,
      type: input.type,
      scope: input.scope,
      content,
      summary: input.summary ?? content.slice(0, 140),
      source: input.source ?? "system",
      importance: input.importance ?? 0.5,
      confidence: input.confidence ?? 0.8,
      tags: input.tags ?? [],
      expiresAt: input.expiresAt ?? (input.type === "SHORT_TERM" ? new Date(Date.now() + 86_400_000) : null),
    },
  });

  try {
    const [vector] = await embedTexts([content]);
    await storeVector("Memory", memory.id, vector);
  } catch (err) {
    log.warn("memory embedding failed — memory is still searchable by keyword", err);
  }
  return memory.id;
}

export async function searchMemory(workspaceId: string, query: string, limit = 8) {
  const memories = await prisma.memory.findMany({
    where: {
      workspaceId,
      enabled: true,
      OR: terms(query).map((t) => ({ content: { contains: t, mode: "insensitive" as const } })),
    },
    orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });
  if (memories.length) {
    await prisma.memory.updateMany({
      where: { id: { in: memories.map((m) => m.id) } },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
    });
  }
  return memories;
}

/** Lifecycle maintenance: expire short-term entries and decay low-importance items. */
export async function runMemoryLifecycle(workspaceId: string) {
  const now = new Date();
  const [expired, decayed] = await Promise.all([
    prisma.memory.updateMany({
      where: { workspaceId, expiresAt: { lt: now }, type: "SHORT_TERM", enabled: true },
      data: { enabled: false },
    }),
    prisma.memory.updateMany({
      where: {
        workspaceId,
        enabled: true,
        importance: { lt: 0.25 },
        lastAccessedAt: { lt: new Date(Date.now() - 30 * 86_400_000) },
      },
      data: { enabled: false },
    }),
  ]);
  return { expired: expired.count, decayed: decayed.count };
}

function terms(query: string) {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    ),
  ).slice(0, 6);
}
