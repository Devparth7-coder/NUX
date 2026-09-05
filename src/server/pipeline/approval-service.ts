import type { ApprovalStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { emit } from "@/lib/orchestration/engine";
import { bus } from "@/lib/events/bus";
import { notify, recordActivity, recordAudit } from "@/server/services/activity";
import { resumeRun } from "./run-service";

export type Decision = "APPROVED" | "DENIED" | "MODIFIED";

/**
 * Human-in-the-loop gate. Approving never executes anything directly: it records
 * the decision and re-enters the orchestrator, which re-runs the (approved)
 * tool executions itself.
 */
export async function decideApproval(args: {
  approvalId: string;
  userId: string;
  workspaceId: string;
  decision: Decision;
  note?: string | null;
  modifiedInput?: Record<string, unknown> | null;
  ip?: string | null;
}) {
  const approval = await prisma.approval.findFirst({ where: { id: args.approvalId, workspaceId: args.workspaceId } });
  if (!approval) throw Errors.notFound("Approval");
  if (approval.status !== "PENDING") throw Errors.conflict(`Approval is already ${approval.status}`);

  const status: ApprovalStatus = args.decision === "APPROVED" ? "APPROVED" : args.decision === "DENIED" ? "DENIED" : "MODIFIED";

  const updated = await prisma.approval.update({
    where: { id: approval.id },
    data: {
      status,
      decidedById: args.userId,
      decidedAt: new Date(),
      decisionNote: args.note ?? null,
      payload: args.modifiedInput
        ? ({ ...(approval.payload as object), input: args.modifiedInput } as Prisma.InputJsonValue)
        : undefined,
    },
  });

  if (approval.toolExecutionId) {
    await prisma.toolExecution.update({
      where: { id: approval.toolExecutionId },
      data: {
        status: status === "DENIED" ? "DENIED" : "PENDING",
        input: args.modifiedInput ? (args.modifiedInput as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  const runId = approval.runId ?? "";
  await emit(runId, null, status === "DENIED" ? "APPROVAL_DENIED" : "APPROVAL_GRANTED", status === "DENIED" ? `Denied: ${approval.title}` : `Approved: ${approval.title}`, {
    approvalId: approval.id,
    toolKey: approval.toolKey,
    decision: status,
  });

  await recordActivity({
    workspaceId: args.workspaceId,
    userId: args.userId,
    kind: "APPROVAL",
    action: `approval.${status.toLowerCase()}`,
    summary: `${status === "DENIED" ? "Denied" : "Approved"}: ${approval.title}`,
    detail: { approvalId: approval.id, toolKey: approval.toolKey, note: args.note ?? null },
    entityType: "APPROVAL",
    entityId: approval.id,
    status: status === "DENIED" ? "warning" : "success",
  });

  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: `approval.${status.toLowerCase()}`,
    entityType: "APPROVAL",
    entityId: approval.id,
    detail: { toolKey: approval.toolKey, decision: status },
    ip: args.ip ?? null,
  });

  bus.publish(`workspace:${args.workspaceId}`, "approval.updated", `Approval ${status}`, { approvalId: approval.id });

  // Workflow gates: the approval carries the workflow run id in its payload.
  const payload = approval.payload as { workflowRunId?: string } | null;
  if (!runId && payload?.workflowRunId) {
    if (status === "APPROVED" || status === "MODIFIED") {
      const { resumeWorkflowRun } = await import("@/lib/orchestration/workflow-engine");
      await resumeWorkflowRun(payload.workflowRunId);
    }
    return updated;
  }

  // Resume only when every approval for this intent has been resolved.
  if (runId && status !== "DENIED") {
    const pending = await prisma.approval.count({
      where: { status: "PENDING", run: { intentId: (await prisma.agentRun.findUnique({ where: { id: runId }, select: { intentId: true } }))?.intentId ?? "" } },
    });
    if (pending === 0) {
      const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { parentRunId: true, workspaceId: true } });
      const graphRunId = run?.parentRunId ?? runId;
      const prefs = await prisma.userPreference.findUnique({ where: { userId: args.userId } });
      await resumeRun(graphRunId, args.userId, prefs?.autoApproveRead ?? true);
    }
  }

  if (status === "DENIED") {
    await notify({
      workspaceId: args.workspaceId,
      userId: args.userId,
      kind: "RUN_COMPLETED",
      title: "Action denied",
      body: `NEXUS skipped “${approval.title}”.`,
      href: `/approvals`,
    });
  }

  return updated;
}

/** Approves every pending approval for an intent in one action. */
export async function approveAllForIntent(intentId: string, userId: string, workspaceId: string) {
  const approvals = await prisma.approval.findMany({
    where: { status: "PENDING", run: { intentId } },
    select: { id: true },
  });
  for (const approval of approvals) {
    await decideApproval({ approvalId: approval.id, userId, workspaceId, decision: "APPROVED" });
  }
  return approvals.length;
}
