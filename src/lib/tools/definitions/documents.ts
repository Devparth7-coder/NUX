import { z } from "zod";
import { prisma } from "@/lib/db";
import { registerTool } from "@/lib/tools/registry";
import { hybridSearch } from "@/lib/retrieval/hybrid";
import { storage } from "@/lib/storage";

registerTool({
  key: "documents.search",
  name: "Search documents",
  description: "Hybrid semantic + keyword search across indexed document chunks. Returns real excerpts with provenance.",
  category: "DOCUMENTS",
  permissionLevel: "READ",
  inputSchema: z.object({
    query: z.string().min(2).describe("What to look for"),
    projectId: z.string().nullish(),
    limit: z.number().int().min(1).max(25).default(8),
  }),
  summarize: (i) => `Search workspace documents for “${i.query}”`,
  affectedData: (i) => ({ query: i.query, projectId: i.projectId ?? null, limit: i.limit ?? 8 }),
  handler: async (input, ctx) => {
    const results = await hybridSearch({
      workspaceId: ctx.workspaceId,
      query: input.query,
      projectId: input.projectId ?? null,
      limit: input.limit ?? 8,
      includeTasks: false,
      includeKnowledge: false,
      includeMemory: false,
    });
    return {
      query: input.query,
      count: results.length,
      results: results.map((r) => ({
        documentId: (r.metadata.documentId as string) ?? null,
        title: r.title,
        excerpt: r.snippet,
        page: r.metadata.page ?? null,
        section: r.metadata.section ?? null,
        score: r.score.total,
        why: r.why,
      })),
    };
  },
});

registerTool({
  key: "documents.list",
  name: "List documents",
  description: "List workspace documents with ingestion status.",
  category: "DOCUMENTS",
  permissionLevel: "READ",
  inputSchema: z.object({ projectId: z.string().nullish(), limit: z.number().int().min(1).max(50).default(20) }),
  summarize: () => "List workspace documents",
  handler: async (input, ctx) =>
    prisma.document.findMany({
      where: { workspaceId: ctx.workspaceId, ...(input.projectId ? { projectId: input.projectId } : {}) },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 20,
      select: { id: true, title: true, status: true, chunkCount: true, mimeType: true, size: true, createdAt: true, projectId: true },
    }),
});

registerTool({
  key: "documents.read",
  name: "Read document",
  description: "Read the extracted chunks of a specific document.",
  category: "DOCUMENTS",
  permissionLevel: "READ",
  inputSchema: z.object({ documentId: z.string(), limit: z.number().int().min(1).max(80).default(25) }),
  summarize: (i) => `Read document ${i.documentId}`,
  handler: async (input, ctx) => {
    const doc = await prisma.document.findFirst({ where: { id: input.documentId, workspaceId: ctx.workspaceId } });
    if (!doc) throw new Error("Document not found");
    const chunks = await prisma.documentChunk.findMany({
      where: { documentId: doc.id },
      orderBy: { position: "asc" },
      take: input.limit ?? 25,
      select: { id: true, content: true, page: true, section: true, position: true },
    });
    return { id: doc.id, title: doc.title, status: doc.status, summary: doc.summary, chunks };
  },
});

registerTool({
  key: "files.read",
  name: "Read stored file",
  description: "Read the raw bytes of an uploaded file from object storage.",
  category: "FILES",
  permissionLevel: "READ",
  inputSchema: z.object({ documentId: z.string(), maxBytes: z.number().int().min(1).max(2_000_000).default(200_000) }),
  summarize: (i) => `Read stored file for document ${i.documentId}`,
  handler: async (input, ctx) => {
    const doc = await prisma.document.findFirst({ where: { id: input.documentId, workspaceId: ctx.workspaceId } });
    if (!doc) throw new Error("Document not found");
    const buffer = await storage().get(doc.storageKey);
    const max = input.maxBytes ?? 200_000;
    return {
      title: doc.title,
      bytes: buffer.byteLength,
      text: buffer.subarray(0, max).toString("utf8"),
      truncated: buffer.byteLength > max,
    };
  },
});
