import { z } from "zod";
import type { AgentDefinition } from "./types";
import { agentModelCall } from "./tooling";
import { pace } from "@/lib/orchestration/pacing";

const PlanSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        agent: z.string(),
        capability: z.string(),
        dependsOn: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  milestones: z.array(z.object({ title: z.string(), dueOffsetDays: z.number() })).default([]),
  risks: z
    .array(z.object({ title: z.string(), severity: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"), mitigation: z.string() }))
    .default([]),
  notes: z.string().default(""),
});

/**
 * PLANNING AGENT — decomposes the objective into an ordered plan, milestones and
 * risks using the real project/task state retrieved by the Context Engine.
 */
export const planningAgent: AgentDefinition = {
  key: "planning",
  name: "Planning Agent",
  description: "Decomposes objectives into ordered plans, milestones, dependencies and risks.",
  systemPrompt:
    "You decompose an objective into an executable plan. Use only the provided workspace ground truth. Never invent facts or sources.",
  capabilities: ["planning", "objective_decomposition", "dependency_mapping", "risk_detection"],
  allowedTools: ["projects.read", "tasks.list", "knowledge.retrieve"],
  permissionLevel: "READ",
  model: "nexus-default",
  temperature: 0.2,
  run: async (ctx) => {
    ctx.log("Decomposing objective into an execution plan");

    const { prisma } = await import("@/lib/db");
    const openTasks = ctx.context.openTasks.length
      ? ctx.context.openTasks
      : await prisma.task
          .findMany({
            where: { workspaceId: ctx.workspaceId, ...(ctx.projectId ? { projectId: ctx.projectId } : {}), status: { not: "DONE" } },
            select: { id: true, title: true, status: true, dueDate: true },
            take: 20,
          })
          .then((rows) => rows.map((t) => ({ ...t, priority: "MEDIUM", dueDate: t.dueDate?.toISOString() ?? null })));

    const completion = await agentModelCall<z.infer<typeof PlanSchema>>(
      ctx,
      "plan.create",
      { intent: ctx.intent, existingTasks: openTasks, documentCount: ctx.context.documents.length },
      PlanSchema,
    );

    const plan = completion.data ?? PlanSchema.parse({});
    await pace(1.2);

    const deadline = ctx.intent.deadline ? new Date(ctx.intent.deadline) : null;
    const sequenced = openTasks.map((task, index) => {
      const due = deadline
        ? new Date(deadline.getTime() - Math.max(0, openTasks.length - 1 - index) * 86_400_000).toISOString()
        : null;
      return { taskId: task.id, title: task.title, status: task.status, proposedDueDate: due };
    });

    ctx.log(`Plan created with ${plan.steps.length} step(s) and ${sequenced.length} sequenced task(s)`);

    return {
      status: "COMPLETED",
      summary: `Plan created: ${plan.steps.length} step(s), ${plan.milestones.length} milestone(s), ${plan.risks.length} risk(s).`,
      output: {
        steps: plan.steps,
        milestones: plan.milestones,
        risks: plan.risks,
        notes: plan.notes,
        sequencedTasks: sequenced,
        taskCount: sequenced.length,
        simulated: completion.simulated,
      },
      tokensIn: completion.usage.promptTokens,
      tokensOut: completion.usage.completionTokens,
      costUsd: completion.usage.costUsd,
    };
  },
};
