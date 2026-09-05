import { describe, expect, it, beforeAll } from "vitest";
import { prisma, WORKSPACE_ID, USER_ID } from "./helpers";
import { startRun } from "@/server/pipeline/run-service";
import { decideApproval } from "@/server/pipeline/approval-service";
import { waitFor } from "./helpers";

/**
 * Approval enforcement: an execution that needs permission must halt, create an
 * Approval row, and must NOT touch the database until the human decides.
 */
describe("Approval gate", () => {
  let intentId: string;
  let runId: string;

  beforeAll(async () => {
    const result = await startRun({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      rawInput: "Schedule the remaining NEXUS launch tasks for this week",
      autoApproveRead: true,
    });
    intentId = result.intentId;
    runId = result.runId;
  });

  it("halts the run and creates approval records", async () => {
    const run = await waitFor(
      async () => prisma.agentRun.findFirst({ where: { id: runId, status: { in: ["WAITING_APPROVAL", "COMPLETED", "FAILED"] } } }),
      { label: "run to halt for approval", timeout: 90_000 },
    );
    const approvals = await prisma.approval.findMany({ where: { run: { intentId } } });
    expect(approvals.length).toBeGreaterThan(0);
    expect(approvals.every((a) => a.status === "PENDING")).toBe(true);
    expect(run.status).toBe("WAITING_APPROVAL");

    // Nothing has been executed yet.
    const pending = await prisma.toolExecution.findMany({ where: { run: { intentId } } });
    expect(pending.some((e) => e.status === "AWAITING_APPROVAL")).toBe(true);
    expect(pending.every((e) => e.status !== "SUCCEEDED" || e.permissionLevel === "READ")).toBe(true);
  });

  it("executes approved actions and records the decision", async () => {
    const approvals = await prisma.approval.findMany({ where: { run: { intentId } }, orderBy: { createdAt: "asc" } });
    for (const approval of approvals) {
      await decideApproval({ approvalId: approval.id, userId: USER_ID, workspaceId: WORKSPACE_ID, decision: "APPROVED" });
    }

    const run = await waitFor(
      async () => prisma.agentRun.findFirst({ where: { id: runId, status: { in: ["COMPLETED", "PARTIAL", "FAILED"] } } }),
      { label: "run to complete after approval", timeout: 120_000 },
    );
    expect(["COMPLETED", "PARTIAL"]).toContain(run.status);

    const decided = await prisma.approval.findMany({ where: { run: { intentId } } });
    expect(decided.every((a) => a.status === "APPROVED")).toBe(true);

    const succeeded = await prisma.toolExecution.findMany({ where: { run: { intentId } }, orderBy: { createdAt: "asc" } });
    expect(succeeded.some((e) => e.status === "SUCCEEDED" && e.permissionLevel === "WRITE")).toBe(true);

    const audit = await prisma.auditLog.findMany({ where: { workspaceId: WORKSPACE_ID, entityType: "APPROVAL" } });
    expect(audit.length).toBeGreaterThan(0);
  });

  it("produces a validated result with an artifact", async () => {
    const intent = await prisma.intent.findUnique({ where: { id: intentId } });
    expect(intent?.status).toBe("COMPLETED");
    const artifact = await prisma.artifact.findFirst({ where: { intentId } });
    expect(artifact).toBeTruthy();
    expect(artifact!.content.length).toBeGreaterThan(100);
    const result = (intent?.metadata as { result?: { tasks: { total: number }; recommendations: unknown[] } } | null)?.result;
    expect(result).toBeTruthy();
    expect(result!.tasks.total).toBeGreaterThan(0);
  });
});
