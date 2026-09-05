import { z } from "zod";
import { prisma } from "@/lib/db";
import { registerTool } from "@/lib/tools/registry";
import { hybridSearch } from "@/lib/retrieval/hybrid";

registerTool({
  key: "knowledge.retrieve",
  name: "Retrieve knowledge",
  description: "Hybrid retrieval over the knowledge graph (facts, decisions, concepts, risks).",
  category: "KNOWLEDGE",
  permissionLevel: "READ",
  inputSchema: z.object({
    query: z.string().min(2),
    projectId: z.string().nullish(),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  summarize: (i) => `Retrieve knowledge for “${i.query}”`,
  affectedData: (i) => ({ query: i.query }),
  handler: async (input, ctx) => {
    const results = await hybridSearch({
      workspaceId: ctx.workspaceId,
      query: input.query,
      projectId: input.projectId ?? null,
      limit: input.limit ?? 8,
      includeDocuments: false,
      includeTasks: false,
      includeMemory: false,
    });
    return {
      count: results.length,
      items: results.map((r) => ({
        id: r.id,
        label: r.title,
        content: r.snippet,
        score: r.score.total,
        why: r.why,
        metadata: r.metadata,
      })),
    };
  },
});

registerTool({
  key: "knowledge.related",
  name: "Find related knowledge",
  description: "Walk the knowledge graph from a node to its real relations.",
  category: "KNOWLEDGE",
  permissionLevel: "READ",
  inputSchema: z.object({ itemId: z.string() }),
  summarize: (i) => `Traverse relations from knowledge item ${i.itemId}`,
  handler: async (input, ctx) => {
    const node = await prisma.knowledgeItem.findFirst({ where: { id: input.itemId, workspaceId: ctx.workspaceId } });
    if (!node) throw new Error("Knowledge item not found");
    const relations = await prisma.knowledgeRelation.findMany({
      where: { OR: [{ sourceId: node.id }, { targetId: node.id }] },
      include: {
        source: { select: { id: true, label: true, kind: true } },
        target: { select: { id: true, label: true, kind: true } },
      },
      take: 40,
    });
    return {
      root: { id: node.id, label: node.label, kind: node.kind },
      relations: relations.map((r) => ({
        type: r.type,
        weight: r.weight,
        evidence: r.evidence,
        source: r.source,
        target: r.target,
      })),
    };
  },
});
