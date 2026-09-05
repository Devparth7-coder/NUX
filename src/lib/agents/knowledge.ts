import { z } from "zod";
import type { AgentDefinition } from "./types";
import { agentModelCall, invokeTool } from "./tooling";
import { pace } from "@/lib/orchestration/pacing";

const KnowledgeSchema = z.object({
  insights: z
    .array(z.object({ itemId: z.string().default(""), label: z.string().default(""), insight: z.string().default("") }))
    .default([]),
  relations: z
    .array(
      z.object({
        source: z.string(),
        target: z.string(),
        type: z.string(),
        weight: z.number().default(0.5),
        evidence: z.string().default(""),
      }),
    )
    .default([]),
  entityCount: z.number().default(0),
});

/**
 * KNOWLEDGE AGENT — structures project knowledge and walks the knowledge graph.
 */
export const knowledgeAgent: AgentDefinition = {
  key: "knowledge",
  name: "Knowledge Agent",
  description: "Structures project knowledge, discovers relationships and organises context.",
  systemPrompt: "You organise knowledge. Only describe relationships supported by retrieved workspace content.",
  capabilities: ["document_understanding", "knowledge_retrieval", "relationship_discovery", "organization"],
  allowedTools: ["knowledge.retrieve", "knowledge.related", "documents.search"],
  permissionLevel: "READ",
  model: "nexus-default",
  temperature: 0.2,
  run: async (ctx) => {
    const query = ctx.intent.desiredOutcome || ctx.intent.objective;
    ctx.log("Retrieving project knowledge");

    const retrieve = await invokeTool(ctx, "knowledge.retrieve", { query, projectId: ctx.projectId ?? null, limit: 10 });
    const items = (retrieve.ok ? (retrieve.output as { items?: Array<Record<string, unknown>> }) : null)?.items ?? [];
    ctx.log(`Retrieved ${items.length} knowledge item(s)`);

    const firstId = items.length ? String((items[0] as { id?: string }).id ?? "") : "";
    if (firstId) {
      const related = await invokeTool(ctx, "knowledge.related", { itemId: firstId });
      if (related.ok) ctx.log("Traversed knowledge graph relations");
    }
    await pace(1);

    const completion = await agentModelCall<z.infer<typeof KnowledgeSchema>>(
      ctx,
      "knowledge.synthesize",
      { items },
      KnowledgeSchema,
    );
    const knowledge = completion.data ?? KnowledgeSchema.parse({});

    return {
      status: "COMPLETED",
      summary: `Knowledge structured: ${knowledge.insights.length} insight(s), ${knowledge.relations.length} relation candidate(s).`,
      output: { ...knowledge, simulated: completion.simulated },
      tokensIn: completion.usage.promptTokens,
      tokensOut: completion.usage.completionTokens,
      costUsd: completion.usage.costUsd,
    };
  },
};
