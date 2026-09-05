import { z } from "zod";
import type { AgentDefinition, AgentContext } from "./types";
import { agentModelCall } from "./tooling";
import { prisma } from "@/lib/db";
import { pace } from "@/lib/orchestration/pacing";

const ReviewSchema = z.object({
  passed: z.boolean().default(false),
  checks: z
    .array(z.object({ name: z.string(), status: z.enum(["pass", "warn", "fail"]).default("pass"), detail: z.string().default("") }))
    .default([]),
  recommendations: z
    .array(z.object({ title: z.string(), detail: z.string().default(""), severity: z.enum(["low", "medium", "high"]).default("medium") }))
    .default([]),
});

/**
 * REVIEW AGENT — validates the produced result against the workspace state.
 * Every check below is computed from real rows, not asserted.
 */
export const reviewAgent: AgentDefinition = {
  key: "review",
  name: "Review Agent",
  description: "Validates outputs, detects gaps and generates grounded recommendations.",
  systemPrompt: "You are a critical reviewer. Flag gaps precisely and never invent completion.",
  capabilities: ["quality_checking", "validation", "error_detection", "recommendations"],
  allowedTools: ["tasks.list", "documents.search", "knowledge.retrieve", "projects.read"],
  permissionLevel: "READ",
  model: "nexus-default",
  temperature: 0.1,
  run: async (ctx) => {
    ctx.log("Validating execution results");
    const deadline = ctx.intent.deadline ? new Date(ctx.intent.deadline) : null;

    const [tasks, approvals, artifacts, unassigned] = await Promise.all([
      prisma.task.findMany({
        where: { workspaceId: ctx.workspaceId, ...(ctx.projectId ? { projectId: ctx.projectId } : {}) },
        select: { id: true, title: true, status: true, priority: true, dueDate: true, assigneeId: true, blockedReason: true },
        take: 50,
      }),
      prisma.approval.findMany({ where: { run: { intentId: ctx.intentId } }, select: { id: true, status: true, toolKey: true } }),
      prisma.artifact.findMany({ where: { intentId: ctx.intentId }, select: { id: true, type: true, title: true } }),
      prisma.task.count({ where: { workspaceId: ctx.workspaceId, ...(ctx.projectId ? { projectId: ctx.projectId } : {}), assigneeId: null, status: { not: "DONE" } } }),
    ]);

    const researchOutput = (ctx.priorOutputs["step-research"] ?? {}) as { findings?: Array<{ confidence: number }>; confidence?: number };
    const findings = researchOutput.findings ?? [];

    const checks = await computeChecks(ctx, tasks, deadline, unassigned, findings, approvals, artifacts);

    const completion = await agentModelCall<z.infer<typeof ReviewSchema>>(
      ctx,
      "review.validate",
      { checks, tasks, deadline: deadline?.toISOString() ?? null, findings },
      ReviewSchema,
    );
    const modelReview = completion.data ?? ReviewSchema.parse({});
    await pace(1);

    // Model suggestions are merged with — never substituted for — computed checks.
    const recommendations = dedupeRecommendations([
      ...checks.filter((c) => c.status !== "pass").map((c) => ({ title: c.name, detail: c.detail, severity: c.status === "fail" ? ("high" as const) : ("medium" as const) })),
      ...modelReview.recommendations,
    ]).slice(0, 5);

    const passed = checks.every((c) => c.status !== "fail");
    ctx.log(`Validation ${passed ? "completed" : "completed with issues"}: ${recommendations.length} recommendation(s)`);

    return {
      status: "COMPLETED",
      summary: `Validation ${passed ? "passed" : "found issues"}: ${checks.length} check(s), ${recommendations.length} recommendation(s).`,
      output: {
        passed,
        checks,
        recommendations,
        validationChecks: checks.length,
        recommendationCount: recommendations.length,
        simulated: completion.simulated,
      },
      tokensIn: completion.usage.promptTokens,
      tokensOut: completion.usage.completionTokens,
      costUsd: completion.usage.costUsd,
    };
  },
};

async function computeChecks(
  ctx: AgentContext,
  tasks: Array<{ id: string; title: string; status: string; priority: string; dueDate: Date | null; assigneeId: string | null; blockedReason?: string | null }>,
  deadline: Date | null,
  unassigned: number,
  findings: Array<{ confidence: number }>,
  approvals: Array<{ id: string; status: string; toolKey: string }>,
  artifacts: Array<{ id: string; type: string; title: string }>,
) {
  const open = tasks.filter((t) => t.status !== "DONE");
  const checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }> = [];

  checks.push({
    name: "Every open task has a due date",
    status: open.every((t) => t.dueDate) ? "pass" : "warn",
    detail: open.every((t) => t.dueDate)
      ? `${open.length} open task(s) are all dated.`
      : `${open.filter((t) => !t.dueDate).length} open task(s) still have no due date.`,
  });

  if (deadline) {
    const outside = open.filter((t) => t.dueDate && t.dueDate > deadline);
    checks.push({
      name: "Work fits inside the deadline window",
      status: outside.length === 0 ? "pass" : "fail",
      detail: outside.length ? `${outside.length} task(s) are scheduled after ${deadline.toISOString().slice(0, 10)}.` : `All ${open.length} open task(s) land on or before ${deadline.toISOString().slice(0, 10)}.`,
    });
  }

  checks.push({
    name: "Every open task has an owner",
    status: unassigned === 0 ? "pass" : "warn",
    detail: unassigned === 0 ? "All open tasks are assigned." : `${unassigned} open task(s) have no assignee.`,
  });

  const blocked = tasks.filter((t) => t.status === "BLOCKED" || (t.blockedReason ?? "").length > 0);
  checks.push({
    name: "No blocked work in the critical path",
    status: blocked.length === 0 ? "pass" : "warn",
    detail: blocked.length
      ? `${blocked.length} task(s) carry a blocker: ${blocked.slice(0, 2).map((t) => t.title).join(", ")}.`
      : "No blocked tasks detected.",
  });

  if (ctx.intent.objective === "launch") {
    const communication = await prisma.artifact.findFirst({
      where: { workspaceId: ctx.workspaceId, ...(ctx.projectId ? { projectId: ctx.projectId } : {}), type: { in: ["BRIEF", "DOCUMENT", "PRESENTATION"] } },
      select: { id: true, title: true },
    });
    checks.push({
      name: "Launch communication drafted",
      status: communication ? "pass" : "warn",
      detail: communication ? `Draft available: ${communication.title}.` : "No launch announcement or brief has been drafted yet.",
    });
  }

  const pending = approvals.filter((a) => a.status === "PENDING");
  checks.push({
    name: "No unresolved approvals",
    status: pending.length === 0 ? "pass" : "warn",
    detail: pending.length ? `${pending.length} action(s) are still awaiting your decision.` : "All requested actions were resolved.",
  });

  if (findings.length) {
    const avg = findings.reduce((a, f) => a + f.confidence, 0) / findings.length;
    checks.push({
      name: "Evidence confidence above 0.6",
      status: avg >= 0.6 ? "pass" : "warn",
      detail: `Mean confidence ${avg.toFixed(2)} across ${findings.length} finding(s).`,
    });
  }

  const hasAnnouncement = artifacts.some((a) => a.type === "BRIEF" || a.type === "DOCUMENT" || a.type === "PRESENTATION");
  if (ctx.intent.requiredCapabilities.includes("content")) {
    checks.push({
      name: "Launch communication drafted",
      status: hasAnnouncement ? "pass" : "warn",
      detail: hasAnnouncement ? "A communication artifact was produced." : "No announcement copy has been drafted yet.",
    });
  }

  return checks;
}

function dedupeRecommendations(items: Array<{ title: string; detail: string; severity: "low" | "medium" | "high" }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
