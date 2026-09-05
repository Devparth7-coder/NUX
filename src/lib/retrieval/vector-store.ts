import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";

type VectorTable = "DocumentChunk" | "KnowledgeItem" | "Memory";

/** Writes a vector into a pgvector column (Prisma cannot write `Unsupported` fields directly). */
export async function storeVector(table: VectorTable, id: string, vector: number[]) {
  const literal = `[${vector.join(",")}]`;
  try {
    await prisma.$executeRaw`
      UPDATE "${Prisma.raw(table)}" SET embedding = ${literal}::vector WHERE id = ${id}
    `;
    return true;
  } catch (err) {
    log.error(`failed to store vector on ${table}:${id}`, err);
    return false;
  }
}

export async function storeVectors(table: VectorTable, entries: Array<{ id: string; vector: number[] }>) {
  const results = await Promise.all(entries.map((e) => storeVector(table, e.id, e.vector)));
  return results.filter(Boolean).length;
}

export async function vectorCount(table: VectorTable, workspaceId?: string) {
  if (workspaceId && table !== "DocumentChunk") {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "${Prisma.raw(table)}" WHERE embedding IS NOT NULL AND "workspaceId" = ${workspaceId}
    `;
    return Number(rows[0]?.count ?? 0);
  }
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "${Prisma.raw(table)}" WHERE embedding IS NOT NULL
  `;
  return Number(rows[0]?.count ?? 0);
}
