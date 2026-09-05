import { z } from "zod";
import type { AgentDefinition } from "./types";
import { agentModelCall, invokeTool } from "./tooling";
import { pace } from "@/lib/orchestration/pacing";

const ArtifactSchema = z.object({
  title: z.string().default("Draft"),
  type: z.string().default("DOCUMENT"),
  summary: z.string().default(""),
  content: z.string().default(""),
  format: z.string().default("markdown"),
});

/**
 * CREATIVE AGENT — drafts communication and presentation content grounded in the
 * plan produced upstream. Drafting is a write (artifact), so it asks first.
 */
export const creativeAgent: AgentDefinition = {
  key: "creative",
  name: "Creative Agent",
  description: "Writes announcements, presentations and content grounded in verified plans.",
  systemPrompt: "You write concise, specific copy grounded strictly in the provided plan and facts.",
  capabilities: ["writing", "presentations", "content", "ideation"],
  allowedTools: ["artifact.generate", "documents.search", "knowledge.retrieve"],
  permissionLevel: "WRITE",
  model: "nexus-default",
  temperature: 0.6,
  run: async (ctx) => {
    ctx.log("Drafting communication content");
    const plan = ctx.priorOutputs["step-plan"] ?? {};
    const sequenced = (plan.sequencedTasks as Array<{ title: string; proposedDueDate: string | null }> | undefined) ?? [];

    const sections = [
      {
        heading: "What is launching",
        body: ctx.intent.projectContext
          ? `${ctx.intent.projectContext.name} is preparing to launch${ctx.intent.deadlineText ? ` ${ctx.intent.deadlineText}` : ""}.`
          : "A new initiative is preparing to launch.",
      },
      {
        heading: "Why it matters",
        body: ctx.intent.desiredOutcome,
      },
      {
        heading: "What happens next",
        body: sequenced.length
          ? sequenced.map((t, i) => `${i + 1}. ${t.title}${t.proposedDueDate ? ` — by ${t.proposedDueDate.slice(0, 10)}` : ""}`).join("\n")
          : "Sequenced work will be confirmed once the plan is approved.",
      },
    ];

    const completion = await agentModelCall<z.infer<typeof ArtifactSchema>>(
      ctx,
      "artifact.write",
      {
        kind: "BRIEF",
        title: `Launch communication — ${ctx.intent.projectContext?.name ?? "NEXUS"}`,
        sections,
      },
      ArtifactSchema,
    );
    const draft = completion.data ?? ArtifactSchema.parse({});
    await pace(1);

    const invocation = await invokeTool(ctx, "artifact.generate", {
      type: "BRIEF",
      title: draft.title,
      summary: draft.summary,
      content: draft.content,
      format: "markdown",
      projectId: ctx.projectId,
      structured: { sections },
    });

    if (!invocation.ok) {
      return {
        status: "FAILED",
        summary: `Draft could not be saved: ${invocation.error}`,
        output: { draft, error: invocation.error },
        error: invocation.error,
      };
    }

    if (invocation.awaitingApproval) {
      return {
        status: "WAITING_APPROVAL",
        summary: "Draft prepared and awaiting your approval before it is saved.",
        output: { draft, awaiting: true },
        approvalIds: invocation.approvalId ? [invocation.approvalId] : [],
        toolExecutionIds: [invocation.executionId],
        tokensIn: completion.usage.promptTokens,
        tokensOut: completion.usage.completionTokens,
      };
    }

    return {
      status: "COMPLETED",
      summary: `Draft saved: ${draft.title}`,
      output: { draft, artifactSaved: true },
      tokensIn: completion.usage.promptTokens,
      tokensOut: completion.usage.completionTokens,
    };
  },
};
