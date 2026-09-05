import { describe, expect, it } from "vitest";
import { chunkText } from "@/server/services/ingestion";
import { ingestDocument } from "@/server/services/ingestion";
import { prisma, WORKSPACE_ID, USER_ID } from "./helpers";

describe("Document ingestion", () => {
  it("chunks text with overlap-friendly boundaries", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} explains an important concept about the launch plan in detail.`).join(" ");
    const chunks = chunkText(long, 600, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length > 0)).toBe(true);
  });

  it("ingests, chunks, embeds and indexes a real file", async () => {
    const body = `# Test Document\n\nNEXUS validates ingestion end to end. ${"This sentence provides additional context about retrieval quality. ".repeat(12)}`;
    const result = await ingestDocument({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      filename: "ingestion-test.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(body, "utf8"),
    });

    expect(result.status).toBe("INDEXED");
    expect(result.chunks).toBeGreaterThan(0);

    const doc = await prisma.document.findUnique({ where: { id: result.id }, include: { chunks: true } });
    expect(doc?.chunks.length).toBe(result.chunks);
    expect(doc?.summary?.length ?? 0).toBeGreaterThan(10);

    const vectorCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "DocumentChunk" WHERE "documentId" = ${result.id} AND embedding IS NOT NULL
    `;
    expect(Number(vectorCount[0].count)).toBe(result.chunks);

    await prisma.document.delete({ where: { id: result.id } });
  });

  it("fails loudly on unsupported content instead of faking extraction", async () => {
    await expect(
      ingestDocument({
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        filename: "empty.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("", "utf8"),
      }),
    ).rejects.toThrow(/empty/i);
  });
});
