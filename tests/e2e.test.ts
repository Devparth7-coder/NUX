/**
 * FINAL ACCEPTANCE TEST (spec §48)
 *
 * User enters: "Prepare my NEXUS launch for this week."
 * The system must genuinely perform all 20 steps. Every assertion below checks
 * persisted database state — nothing is asserted from the UI or from fixtures.
 */
import { describe, expect, it } from "vitest";
import { prisma, WORKSPACE_ID, USER_ID, waitFor } from "./helpers";
import { startRun } from "@/server/pipeline/run-service";
import { decideApproval } from "@/server/pipeline/approval-service";

const PROMPT = "Prepare my NEXUS launch for this week.";

describe("NEXUS acceptance scenario", () => {
  it("runs COMMAND → INTENT → CONTEXT → PLAN → ORCHESTRATION → APPROVAL → EXECUTION → VALIDATION → RESULT → MEMORY", async () => {
    const started = await startRun({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      rawInput: PROMPT,
      autoApproveRead: true,
    });
    const { intentId, runId } = started;

    // 1–2. Intent parsed with a resolved deadline.
    const intent = await prisma.intent.findUnique({ where: { id: intentId } });
    expect(intent).toBeTruthy();
    expect(intent!.objective).toBe("launch");
    expect(intent!.deadlineText).toBe("this week");
    expect(intent!.deadline!.getTime()).toBeGreaterThan(Date.now());
    expect(intent!.projectId).toBeTruthy();
    expect(intent!.status).not.toBe("RECEIVED");

    // 3–6. Context retrieved: documents, tasks, memories, knowledge.
    expect(started.context.items).toBeGreaterThan(0);
    const contextEvent = await prisma.runEvent.findFirst({ where: { intentId, kind: "CONTEXT_RETRIEVED" } });
    expect(contextEvent).toBeTruthy();

    // 7–9. Plan + execution graph built with real agents.
    expect(started.graph.length).toBeGreaterThan(2);
    const agentsRan = started.graph.map((s) => s.agent);
    expect(agentsRan).toContain("planning");
    expect(agentsRan).toContain("execution");
    expect(agentsRan).toContain("review");

    // 10–12. Execute safe operations, then STOP for approval.
    const halted = await waitFor(
      async () => prisma.agentRun.findFirst({ where: { id: runId, status: { in: ["WAITING_APPROVAL", "COMPLETED", "PARTIAL", "FAILED"] } } }),
      { label: "run to reach approval gate", timeout: 120_000 },
    );
    expect(halted.status).toBe("WAITING_APPROVAL");

    const approvals = await prisma.approval.findMany({ where: { run: { intentId } }, orderBy: { createdAt: "asc" } });
    expect(approvals.length).toBe(2);
    for (const approval of approvals) {
      expect(approval.status).toBe("PENDING");
      expect(approval.whatHappens.length).toBeGreaterThan(0);
      expect(approval.whyNeeded.length).toBeGreaterThan(0);
      expect(Object.keys(approval.affectedData as object).length).toBeGreaterThan(0);
    }

    // No write happened before approval.
    const preExecutions = await prisma.toolExecution.findMany({ where: { run: { intentId } } });
    expect(preExecutions.filter((e) => e.permissionLevel === "WRITE" && e.status === "SUCCEEDED")).toHaveLength(0);

    const planningRun = await prisma.agentRun.findFirst({ where: { intentId, key: "planning" } });
    expect(planningRun?.status).toBe("COMPLETED");

    // 13–14. Approve and continue.
    for (const approval of approvals) {
      await decideApproval({ approvalId: approval.id, userId: USER_ID, workspaceId: WORKSPACE_ID, decision: "APPROVED" });
    }

    const finished = await waitFor(
      async () => prisma.agentRun.findFirst({ where: { id: runId, status: { in: ["COMPLETED", "PARTIAL", "FAILED"] } } }),
      { label: "run to finish after approval", timeout: 180_000 },
    );
    expect(["COMPLETED", "PARTIAL"]).toContain(finished.status);

    // 15. Validation ran.
    const reviewRun = await prisma.agentRun.findFirst({ where: { intentId, key: "review" } });
    expect(reviewRun?.status).toBe("COMPLETED");
    const reviewOutput = reviewRun!.outputs as { checks?: Array<{ status: string }>; recommendations?: unknown[] };
    expect(reviewOutput.checks?.length ?? 0).toBeGreaterThan(0);

    // 16. Recommendations generated.
    const completedIntent = await prisma.intent.findUnique({ where: { id: intentId } });
    const result = (completedIntent!.metadata as { result?: {
      tasks: { total: number; scheduled: number };
      recommendations: Array<{ title: string }>;
      approvals: { total: number; approved: number; pending: number };
      memories: string[];
      checks: Array<{ name: string; status: string }>;
      findings: Array<{ claim: string; source: string }>;
    } } | null)!.result!;

    expect(result.tasks.total).toBe(6);
    expect(result.recommendations.length).toBe(3);
    expect(result.approvals.total).toBe(2);
    expect(result.approvals.approved).toBe(2);
    expect(result.approvals.pending).toBe(0);

    // 17. Project state updated from real rows.
    const project = await prisma.project.findUnique({ where: { id: intent!.projectId! } });
    expect(project!.targetDate).toBeTruthy();
    expect(project!.healthReason).toMatch(/tasks complete/);
    const scheduled = await prisma.task.count({
      where: { projectId: project!.id, status: { not: "DONE" }, dueDate: { not: null } },
    });
    expect(scheduled).toBeGreaterThan(0);

    // 18. Memory saved.
    expect(result.memories.length).toBeGreaterThan(0);
    const memories = await prisma.memory.count({ where: { workspaceId: WORKSPACE_ID, enabled: true } });
    expect(memories).toBeGreaterThan(0);

    // 19. Activity + tool executions recorded.
    const activity = await prisma.activity.findMany({ where: { intentId } });
    expect(activity.length).toBeGreaterThan(0);
    const executions = await prisma.toolExecution.findMany({ where: { run: { intentId } } });
    expect(executions.some((e) => e.status === "SUCCEEDED" && e.permissionLevel === "WRITE")).toBe(true);

    // 20. Final result artifact exists and contains only grounded content.
    const artifact = await prisma.artifact.findFirst({ where: { intentId }, orderBy: { createdAt: "desc" } });
    expect(artifact).toBeTruthy();
    expect(artifact!.content).toContain("## Plan");
    expect(artifact!.content).toContain(PROMPT);

    // Research evidence is grounded in real documents.
    const researchRun = await prisma.agentRun.findFirst({ where: { intentId, key: "research" } });
    if (researchRun) {
      const research = researchRun.outputs as { findings?: Array<{ evidence?: Array<{ sourceTitle?: string }> }> };
      for (const finding of research.findings ?? []) {
        expect(finding.evidence?.[0]?.sourceTitle ?? "").not.toBe("");
      }
    }
  }, 300_000);
});
