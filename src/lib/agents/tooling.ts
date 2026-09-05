import "@/lib/tools";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { prepareToolCall, runToolExecution } from "@/lib/tools/registry";
import { publishRunEvent } from "@/lib/events/bus";
import type { AgentContext } from "./types";

export type ToolInvocation =
  | { ok: true; output: unknown; executionId: string; approvalId?: string; awaitingApproval: boolean }
  | { ok: false; error: string; executionId?: string };

/**
 * Single gate through which every agent uses a tool:
 * validate input → resolve permissions → persist a ToolExecution row →
 * either halt for approval or execute for real.
 */
export async function invokeTool(
  ctx: AgentContext,
  toolKey: string,
  input: unknown,
  opts: { integrationStatus?: "CONNECTED" | "DISCONNECTED" | "ERROR" | "NOT_CONFIGURED" } = {},
): Promise<ToolInvocation> {
  const prepared = await prepareToolCall({
    key: toolKey,
    input,
    ctx: { workspaceId: ctx.workspaceId, userId: ctx.userId, projectId: ctx.projectId, runId: ctx.runId, intentId: ctx.intentId },
    autoApproveRead: ctx.autoApproveRead,
    integrationStatus: opts.integrationStatus,
  });

  const toolRow = await prisma.tool.findUnique({
    where: { workspaceId_key: { workspaceId: ctx.workspaceId, key: toolKey } },
    select: { id: true },
  });

  const execution = await prisma.toolExecution.create({
    data: {
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      toolId: toolRow?.id ?? null,
      toolKey,
      status: prepared.decision.requiresApproval ? "AWAITING_APPROVAL" : "PENDING",
      input: prepared.input as Prisma.InputJsonValue,
      permissionLevel: prepared.permissionLevel,
      requiresApproval: prepared.decision.requiresApproval,
    },
  });

  if (prepared.decision.requiresApproval) {
    const approval = await prisma.approval.create({
      data: {
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        toolExecutionId: execution.id,
        toolKey,
        title: prepared.summary,
        whatHappens: prepared.summary,
        whyNeeded: prepared.decision.reason,
        affectedData: prepared.affectedData as Prisma.InputJsonValue,
        permissionLevel: prepared.permissionLevel,
        payload: { input: prepared.input, toolName: prepared.toolName, category: prepared.category } as Prisma.InputJsonValue,
        status: "PENDING",
      },
    });
    publishRunEvent(ctx.runId, ctx.intentId, "APPROVAL_REQUESTED", `Approval required: ${prepared.summary}`, {
      approvalId: approval.id,
      toolKey,
      permissionLevel: prepared.permissionLevel,
      affectedData: prepared.affectedData,
      why: prepared.decision.reason,
    });
    return { ok: true, output: null, executionId: execution.id, approvalId: approval.id, awaitingApproval: true };
  }

  if (!prepared.decision.allowed) {
    await prisma.toolExecution.update({
      where: { id: execution.id },
      data: { status: "FAILED", error: prepared.decision.reason, completedAt: new Date(), durationMs: 0 },
    });
    publishRunEvent(ctx.runId, ctx.intentId, "TOOL_FAILED", `${prepared.toolName}: ${prepared.decision.reason}`, { toolKey });
    return { ok: false, error: prepared.decision.reason, executionId: execution.id };
  }

  try {
    const output = await runToolExecution(execution.id, {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      projectId: ctx.projectId,
      runId: ctx.runId,
      intentId: ctx.intentId,
    });
    return { ok: true, output, executionId: execution.id, awaitingApproval: false };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), executionId: execution.id };
  }
}

/** Model call helper that keeps telemetry attached to the agent's run. */
export async function agentModelCall<T>(
  ctx: AgentContext,
  purpose: string,
  metadata: Record<string, unknown>,
  schema?: import("zod").ZodTypeAny,
  system?: string,
) {
  const { completeWithTelemetry } = await import("@/lib/ai");
  const prompt = buildPrompt(ctx, metadata);
  return completeWithTelemetry<T>(
    {
      purpose,
      system: system ?? `You are the ${ctx.stepId} agent in NEXUS. Use only the provided workspace ground truth. Never invent facts.`,
      messages: [{ role: "user", content: prompt }],
      schema,
      metadata: { ...metadata, runId: ctx.runId, intentId: ctx.intentId },
    },
    { workspaceId: ctx.workspaceId, runId: ctx.runId },
  );
}

function buildPrompt(ctx: AgentContext, metadata: Record<string, unknown>) {
  return JSON.stringify(
    {
      intent: ctx.intent,
      groundTruth: {
        items: ctx.context.items.slice(0, 8).map((i) => ({ title: i.title, snippet: i.snippet, source: i.source })),
        openTasks: ctx.context.openTasks,
        documents: ctx.context.documents,
        memories: ctx.context.memories,
      },
      ...metadata,
    },
    null,
    2,
  ).slice(0, 24_000);
}
