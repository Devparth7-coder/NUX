import { z } from "zod";
import type { AgentDefinition } from "./types";
import { agentModelCall, invokeTool } from "./tooling";
import { pace } from "@/lib/orchestration/pacing";

const AnalystSchema = z.object({
  metrics: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })).default([]),
  insights: z.array(z.string()).default([]),
});

/**
 * ANALYST AGENT — computes real workspace metrics through the data analysis tool.
 */
export const analystAgent: AgentDefinition = {
  key: "analyst",
  name: "Analyst Agent",
  description: "Analyses delivery metrics, trends and comparisons from workspace data.",
  systemPrompt: "You analyse structured data. Report only what the numbers show.",
  capabilities: ["data_analysis", "metrics", "trends", "comparisons"],
  allowedTools: ["data.analyze", "tasks.list", "projects.read"],
  permissionLevel: "READ",
  model: "nexus-default",
  temperature: 0.1,
  run: async (ctx) => {
    ctx.log("Computing delivery metrics");
    const analysis = await invokeTool(ctx, "data.analyze", { projectId: ctx.projectId ?? null, windowDays: 30 });
    await pace(1);

    if (!analysis.ok) {
      return { status: "FAILED", summary: `Analysis failed: ${analysis.error}`, output: {}, error: analysis.error };
    }

    const completion = await agentModelCall<z.infer<typeof AnalystSchema>>(ctx, "analyst.report", { analysis }, AnalystSchema);
    const report = completion.data ?? AnalystSchema.parse({});

    return {
      status: "COMPLETED",
      summary: `Analysis complete: ${report.metrics.length} metric(s), ${report.insights.length} insight(s).`,
      output: { ...report, raw: analysis.output, simulated: completion.simulated },
      tokensIn: completion.usage.promptTokens,
      tokensOut: completion.usage.completionTokens,
    };
  },
};
