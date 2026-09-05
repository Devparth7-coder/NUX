import type { AgentDefinition } from "./types";
import { invokeTool } from "./tooling";
import { prisma } from "@/lib/db";
import { pace } from "@/lib/orchestration/pacing";

type PreparedAction = { toolKey: string; executionId: string; approvalId?: string; label: string };

/**
 * EXECUTION AGENT — performs permitted workspace actions.
 *
 * Nothing is executed speculatively: every action is validated, recorded as a
 * ToolExecution, and stopped for human approval when the permission level
 * demands it. On resume it executes only what the user actually approved.
 */
export const executionAgent: AgentDefinition = {
  key: "execution",
  name: "Execution Agent",
  description: "Executes permitted actions, creates artifacts and updates project state.",
  systemPrompt: "You execute only explicitly permitted actions. Anything that writes, sends or publishes requires approval.",
  capabilities: ["execution", "task_management", "artifact_creation", "state_updates"],
  allowedTools: ["tasks.create", "tasks.update", "tasks.schedule", "projects.update", "artifact.generate"],
  permissionLevel: "WRITE",
  model: "nexus-default",
  temperature: 0.1,
  run: async (ctx) => {
    const prepared = (ctx.runInput.prepared as PreparedAction[] | undefined) ?? null;

    // ── Resume path: the user has ruled on each approval ───────────────────
    if (prepared?.length) {
      ctx.log("Resuming execution with your decisions");
      const results: Array<{ label: string; status: string; output?: unknown; error?: string }> = [];

      for (const action of prepared) {
        const execution = await prisma.toolExecution.findUnique({
          where: { id: action.executionId },
          include: { approvals: true },
        });
        if (!execution) continue;

        const approval = execution.approvals[0];
        if (approval && approval.status === "DENIED") {
          await prisma.toolExecution.update({ where: { id: execution.id }, data: { status: "SKIPPED" } });
          results.push({ label: action.label, status: "DENIED" });
          ctx.log(`Skipped (denied): ${action.label}`);
          continue;
        }
        if (execution.status === "SUCCEEDED") {
          results.push({ label: action.label, status: "SUCCEEDED", output: execution.output });
          continue;
        }
        if (approval && approval.status !== "APPROVED") {
          results.push({ label: action.label, status: "AWAITING_APPROVAL" });
          continue;
        }

        try {
          const { runToolExecution } = await import("@/lib/tools/registry");
          const output = await runToolExecution(execution.id, {
            workspaceId: ctx.workspaceId,
            userId: ctx.userId,
            projectId: ctx.projectId,
            runId: ctx.runId,
            intentId: ctx.intentId,
            approvalId: approval?.id ?? null,
          });
          results.push({ label: action.label, status: "SUCCEEDED", output });
          ctx.log(`Executed: ${action.label}`);
        } catch (err) {
          results.push({ label: action.label, status: "FAILED", error: err instanceof Error ? err.message : String(err) });
          ctx.log(`Failed: ${action.label}`);
        }
        await pace(1);
      }

      const executed = results.filter((r) => r.status === "SUCCEEDED").length;
      const denied = results.filter((r) => r.status === "DENIED").length;
      const failed = results.filter((r) => r.status === "FAILED").length;
      const stillWaiting = results.filter((r) => r.status === "AWAITING_APPROVAL").length;

      return {
        status: stillWaiting ? "WAITING_APPROVAL" : failed && !executed ? "FAILED" : "COMPLETED",
        summary: `Executed ${executed} action(s)${denied ? `, ${denied} denied` : ""}${failed ? `, ${failed} failed` : ""}.`,
        output: { results, executed, denied, failed, mode: "resume" },
      };
    }

    // ── Prepare path: decide what needs to happen, then ask ────────────────
    ctx.log("Preparing permitted workspace actions");
    const deadline = ctx.intent.deadline ? new Date(ctx.intent.deadline) : null;
    const actions: PreparedAction[] = [];

    const { prisma: db } = await import("@/lib/db");
    const openTasks = ctx.context.openTasks.length
      ? ctx.context.openTasks
      : await db.task
          .findMany({
            where: { workspaceId: ctx.workspaceId, ...(ctx.projectId ? { projectId: ctx.projectId } : {}), status: { not: "DONE" } },
            orderBy: [{ priority: "desc" }],
            take: 20,
            select: { id: true, title: true, status: true, priority: true, dueDate: true },
          })
          .then((rows) => rows.map((r) => ({ ...r, dueDate: r.dueDate?.toISOString() ?? null })));

    if (openTasks.length && deadline) {
      const entries = openTasks.map((task, index) => {
        const priority = index === 0 ? "URGENT" : index < 3 ? "HIGH" : "MEDIUM";
        const due = new Date(deadline.getTime() - Math.max(0, openTasks.length - 1 - index) * 86_400_000);
        return { taskId: task.id, dueDate: due.toISOString(), priority: priority as "URGENT" | "HIGH" | "MEDIUM" };
      });
      const invocation = await invokeTool(ctx, "tasks.schedule", { entries });
      if (invocation.ok) {
        actions.push({
          toolKey: "tasks.schedule",
          executionId: invocation.executionId,
          approvalId: invocation.approvalId,
          label: `Schedule ${entries.length} task(s) against the deadline`,
        });
      } else {
        ctx.log(`Task scheduling unavailable: ${invocation.error}`);
      }
    } else if (deadline) {
      const plan = (ctx.priorOutputs["step-plan"]?.draftTasks as Array<{ title: string; priority?: string }> | undefined) ?? [];
      if (plan.length) {
        const invocation = await invokeTool(ctx, "tasks.create", {
          projectId: ctx.projectId,
          tasks: plan.map((t, i) => ({
            title: t.title,
            priority: (t.priority ?? "MEDIUM") as "MEDIUM",
            dueDate: new Date(deadline.getTime() - Math.max(0, plan.length - 1 - i) * 86_400_000).toISOString(),
          })),
        });
        if (invocation.ok) {
          actions.push({
            toolKey: "tasks.create",
            executionId: invocation.executionId,
            approvalId: invocation.approvalId,
            label: `Create ${plan.length} task(s) from the plan`,
          });
        }
      }
    }

    if (ctx.projectId && (deadline || ctx.intent.objective)) {
      const invocation = await invokeTool(ctx, "projects.update", {
        projectId: ctx.projectId,
        targetDate: deadline ? deadline.toISOString() : undefined,
        objective: ctx.intent.objective === "launch" ? `Launch ${ctx.intent.projectContext?.name ?? "the project"}` : undefined,
        healthReason: deadline ? `Deadline set to ${deadline.toISOString().slice(0, 10)}` : undefined,
      });
      if (invocation.ok) {
        actions.push({
          toolKey: "projects.update",
          executionId: invocation.executionId,
          approvalId: invocation.approvalId,
          label: "Update project objective and target date",
        });
      }
    }

    await db.agentRun.update({
      where: { id: ctx.runId },
      data: { input: { ...ctx.runInput, prepared: actions } as never },
    });

    const approvals = actions.filter((a) => a.approvalId);
    if (approvals.length) {
      ctx.log(`Waiting for approval on ${approvals.length} action(s)`);
      return {
        status: "WAITING_APPROVAL",
        summary: `Prepared ${actions.length} action(s). ${approvals.length} require your approval before execution.`,
        output: { prepared: actions, mode: "prepare", awaiting: approvals.length },
        approvalIds: approvals.map((a) => a.approvalId!),
        toolExecutionIds: actions.map((a) => a.executionId),
      };
    }

    return {
      status: "COMPLETED",
      summary: `Executed ${actions.length} permitted action(s).`,
      output: { prepared: actions, mode: "prepare" },
      toolExecutionIds: actions.map((a) => a.executionId),
    };
  },
};
