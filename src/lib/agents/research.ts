import { z } from "zod";
import type { AgentDefinition } from "./types";
import { agentModelCall, invokeTool } from "./tooling";
import { pace } from "@/lib/orchestration/pacing";

const ResearchSchema = z.object({
  query: z.string().default(""),
  summary: z.string().default(""),
  findings: z
    .array(
      z.object({
        id: z.string(),
        claim: z.string(),
        confidence: z.number().min(0).max(1).default(0.5),
        evidence: z
          .array(z.object({ sourceId: z.string(), sourceTitle: z.string(), quote: z.string() }))
          .default([]),
      }),
    )
    .default([]),
  sources: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0),
});

/**
 * RESEARCH AGENT — gathers real evidence through the document + knowledge tools.
 * If an external search provider is unavailable it says so explicitly rather
 * than fabricating sources.
 */
export const researchAgent: AgentDefinition = {
  key: "research",
  name: "Research Agent",
  description: "Discovers, extracts and cross-checks evidence from workspace sources with citations.",
  systemPrompt:
    "You are a research agent. Every claim must be backed by an excerpt retrieved from the workspace. If evidence is missing, report a gap.",
  capabilities: ["research", "source_discovery", "summarization", "evidence_collection"],
  allowedTools: ["documents.search", "documents.read", "knowledge.retrieve", "web.search"],
  permissionLevel: "READ",
  model: "nexus-default",
  temperature: 0.2,
  run: async (ctx) => {
    const query = `${ctx.intent.objective} ${ctx.intent.desiredOutcome}`.slice(0, 240);
    ctx.log("Searching workspace documents for evidence");

    const docSearch = await invokeTool(ctx, "documents.search", {
      query,
      projectId: ctx.projectId ?? null,
      limit: 8,
    });
    await pace(1);

    const searchResult = (docSearch.ok ? (docSearch.output as { results?: Array<Record<string, unknown>>; count?: number }) : null) ?? {
      results: [],
      count: 0,
    };
    ctx.log(`Retrieved ${searchResult.count ?? 0} relevant document excerpts`, { count: searchResult.count ?? 0 });

    const knowledge = await invokeTool(ctx, "knowledge.retrieve", { query, projectId: ctx.projectId ?? null, limit: 6 });
    const knowledgeResult = (knowledge.ok ? (knowledge.output as { items?: Array<Record<string, unknown>>; count?: number }) : null) ?? {
      items: [],
      count: 0,
    };
    ctx.log(`Retrieved ${knowledgeResult.count ?? 0} knowledge items`, { count: knowledgeResult.count ?? 0 });

    const passages = [
      ...(searchResult.results ?? []).map((r) => ({
        id: String(r.documentId ?? r.title ?? "document"),
        title: String(r.title ?? "Document"),
        content: String(r.excerpt ?? ""),
      })),
      ...(knowledgeResult.items ?? []).map((k) => ({
        id: String(k.id ?? k.label ?? "knowledge"),
        title: String(k.label ?? "Knowledge"),
        content: String(k.content ?? ""),
      })),
    ].filter((p) => p.content.length > 20);

    // External search is attempted only when the intent actually calls for it.
    if (ctx.intent.requiredCapabilities.includes("research")) {
      const web = await invokeTool(ctx, "web.search", { query, limit: 5 });
      if (!web.ok) ctx.log(`Web search unavailable: ${web.error}`, { reason: "NO_SEARCH_PROVIDER" });
    }

    const completion = await agentModelCall<z.infer<typeof ResearchSchema>>(ctx, "research.synthesize", { query, passages }, ResearchSchema);
    const research = completion.data ?? ResearchSchema.parse({});
    await pace(1);

    return {
      status: "COMPLETED",
      summary: `Research complete: ${research.findings.length} finding(s) from ${research.sources.length} source(s), confidence ${research.confidence.toFixed(2)}.`,
      output: {
        ...research,
        passageCount: passages.length,
        simulated: completion.simulated,
      },
      tokensIn: completion.usage.promptTokens,
      tokensOut: completion.usage.completionTokens,
      costUsd: completion.usage.costUsd,
    };
  },
};
