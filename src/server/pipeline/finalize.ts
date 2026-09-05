import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emit } from "@/lib/orchestration/engine";
import { saveMemory } from "@/lib/memory/manager";
import { notify, recordActivity } from "@/server/services/activity";
import { log } from "@/lib/logger";

export type RunResult = {
  headline: string;
  summary: string;
  tasks: { total: number; open: number; completed: number; scheduled: number; created: number; titles: string[] };
  recommendations: Array<{ title: string; detail: string; severity: string }>;
  approvals: { total: number; pending: number; approved: number; denied: number };
  findings: Array<{ claim: string; confidence: number; source: string }>;
  checks: Array<{ name: string; status: string; detail: string }>;
  artifacts: Array<{ id: string; title: string; type: string }>;
  memories: string[];
  toolCalls: number;
  agentRuns: number;
  durationMs: number;
  demoMode: boolean;
};

/**
 * Terminal stage: validates what actually happened, writes the deliverable
 * artifact, persists durable memory, updates derived project state and records
 * activity. Every number here is computed from rows, never hard-coded.
 */
export async function finalizeRun(args: {
  runId: string;
  intentId: string;
  workspaceId: string;
  userId: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
}): Promise<RunResult | null> {
  const { runId, intentId, workspaceId, userId, status } = args;

  const [run, intent, children, approvals, executions, existingArtifacts] = await Promise.all([
    prisma.agentRun.findUnique({ where: { id: runId } }),
    prisma.intent.findUnique({ where: { id: intentId } }),
    prisma.agentRun.findMany({ where: { parentRunId: runId }, orderBy: { createdAt: "asc" } }),
    prisma.approval.findMany({ where: { run: { intentId } } }),
    prisma.toolExecution.findMany({ where: { run: { intentId } } }),
    prisma.artifact.findMany({ where: { intentId }, select: { id: true, title: true, type: true } }),
  ]);

  if (!run || !intent) return null;

  const outputs: Record<string, Record<string, unknown>> = {};
  for (const child of children) outputs[`step-${child.key}`] = (child.outputs as Record<string, unknown>) ?? {};

  const planOutput = outputs["step-planning"] ?? {};
  const researchOutput = outputs["step-research"] ?? {};
  const executionOutput = outputs["step-execution"] ?? {};
  const reviewOutput = outputs["step-review"] ?? {};

  const sequenced = (planOutput.sequencedTasks as Array<{ title: string; proposedDueDate: string | null }> | undefined) ?? [];
  const executionResults = (executionOutput.results as Array<{ label: string; status: string }> | undefined) ?? [];

  const createdFromExecution = (executionOutput.results as Array<{ status: string; output?: { created?: Array<{ title: string }> } }> | undefined)
    ?.flatMap((r) => (r.output?.created ?? []).map((c) => c.title)) ?? [];

  const projectId = intent.projectId;
  const tasks = projectId
    ? await prisma.task.findMany({
        where: { projectId },
        select: { id: true, title: true, dueDate: true, priority: true, assigneeId: true, status: true },
        orderBy: [{ status: "asc" }, { priority: "desc" }, { dueDate: "asc" }],
        take: 30,
      })
    : [];

  const scheduledCount =
    (executionOutput.results as Array<{ status: string; output?: { count?: number } }> | undefined)
      ?.filter((r) => r.status === "SUCCEEDED")
      .reduce((acc, r) => acc + (r.output?.count ?? 0), 0) ?? 0;

  const recommendations = (reviewOutput.recommendations as RunResult["recommendations"] | undefined) ?? [];
  const findings = (researchOutput.findings as Array<{ claim: string; confidence: number; evidence?: Array<{ sourceTitle?: string }> }> | undefined) ?? [];
  const checks = (reviewOutput.checks as RunResult["checks"] | undefined) ?? [];

  const durations = children.filter((c) => c.latencyMs).map((c) => c.latencyMs ?? 0);
  const durationMs = durations.reduce((a, b) => a + b, 0);

  const headline =
    intent.objective === "launch"
      ? "Your launch plan is ready"
      : intent.objective === "analyze"
        ? "Your analysis is ready"
        : intent.objective === "research"
          ? "Your research summary is ready"
          : "Your plan is ready";

  const result: RunResult = {
    headline,
    summary: buildSummary({ intent, status, taskCount: tasks.length, recommendations: recommendations.length, pending: approvals.filter((a) => a.status === "PENDING").length }),
    tasks: {
      total: tasks.length || sequenced.length,
      open: tasks.filter((t) => t.status !== "DONE").length,
      completed: tasks.filter((t) => t.status === "DONE").length,
      scheduled: scheduledCount,
      created: createdFromExecution.length,
      titles: (tasks.length ? tasks.map((t) => t.title) : sequenced.map((t) => t.title)).slice(0, 12),
    },
    recommendations,
    approvals: {
      total: approvals.length,
      pending: approvals.filter((a) => a.status === "PENDING").length,
      approved: approvals.filter((a) => a.status === "APPROVED").length,
      denied: approvals.filter((a) => a.status === "DENIED").length,
    },
    findings: findings.slice(0, 6).map((f) => ({
      claim: f.claim,
      confidence: f.confidence,
      source: f.evidence?.[0]?.sourceTitle ?? "workspace",
    })),
    checks,
    artifacts: existingArtifacts,
    memories: [],
    toolCalls: executions.length,
    agentRuns: children.length,
    durationMs,
    demoMode: (run.input as { autoApproveRead?: boolean } | null) !== null && process.env.NEXUS_MODE === "demo",
  };

  // ── Deliverable artifact (a NEXUS output, not an external action) ─────────
  const markdown = renderPlanMarkdown({ intent, result, sequenced, checks, findings, executions });
  const artifact = await prisma.artifact.create({
    data: {
      workspaceId,
      projectId,
      intentId,
      runId,
      createdById: userId,
      type: intent.objective === "launch" ? "TASK_PLAN" : "REPORT",
      title: `${headline} — ${new Date().toISOString().slice(0, 10)}`,
      summary: result.summary,
      content: markdown,
      format: "markdown",
      structured: result as unknown as Prisma.InputJsonValue,
      bytes: Buffer.byteLength(markdown, "utf8"),
    },
  });
  result.artifacts.push({ id: artifact.id, title: artifact.title, type: artifact.type });
  await emit(runId, intentId, "ARTIFACT_CREATED", `Artifact created: ${artifact.title}`, { artifactId: artifact.id });

  // ── Memory ────────────────────────────────────────────────────────────────
  const memories: string[] = [];
  if (intent.deadlineText) {
    const content = `User is driving a "${intent.objective}" objective with a deadline of ${intent.deadlineText}${intent.projectId ? " on the active project" : ""}.`;
    const id = await saveMemory({
      workspaceId,
      userId,
      projectId,
      content,
      type: "PROJECT",
      scope: "PROJECT",
      importance: 0.8,
      source: "intent",
      tags: ["objective", "deadline", intent.objective],
    });
    if (id) memories.push(content);
  }
  if (recommendations.length) {
    const content = `Open recommendations from the last ${intent.objective} run: ${recommendations.slice(0, 3).map((r) => r.title).join("; ")}.`;
    const id = await saveMemory({
      workspaceId,
      userId,
      projectId,
      content,
      type: "LONG_TERM",
      scope: "PROJECT",
      importance: 0.6,
      source: "review-agent",
      tags: ["recommendations"],
    });
    if (id) memories.push(content);
  }
  result.memories = memories;
  if (memories.length) await emit(runId, intentId, "MEMORY_UPDATED", `Saved ${memories.length} memory item(s)`, { memories });

  // ── Derived project state (recomputed from rows) ──────────────────────────
  if (projectId) {
    const all = await prisma.task.findMany({ where: { projectId }, select: { status: true, dueDate: true } });
    const total = all.length || 1;
    const done = all.filter((t) => t.status === "DONE").length;
    const overdue = all.filter((t) => t.dueDate && t.dueDate < new Date() && t.status !== "DONE").length;
    const blocked = all.filter((t) => t.status === "BLOCKED").length;
    const progress = Math.round((done / total) * 100);
    const health = blocked > 0 ? "BLOCKED" : overdue > 0 ? "AT_RISK" : progress >= 100 ? "COMPLETED" : "HEALTHY";
    await prisma.project.update({
      where: { id: projectId },
      data: { progress, health, healthReason: `${done}/${all.length} tasks complete · ${overdue} overdue · ${blocked} blocked` },
    });
  }

  // ── Intent + activity + notification ──────────────────────────────────────
  await prisma.intent.update({
    where: { id: intentId },
    data: {
      status: status === "FAILED" ? "FAILED" : "COMPLETED",
      completedAt: new Date(),
      metadata: { result } as Prisma.InputJsonValue,
    },
  });

  await prisma.agentRun.update({
    where: { id: runId },
    data: { outputs: { ...(run.outputs as object), result } as never },
  });

  await recordActivity({
    workspaceId,
    userId,
    projectId,
    intentId,
    kind: status === "FAILED" ? "ERROR" : "AGENT",
    action: "run.finalize",
    summary: status === "FAILED" ? "Run finished with failures" : `${headline}`,
    detail: { result } as Prisma.InputJsonValue,
    entityType: "RUN",
    entityId: runId,
    status: status === "FAILED" ? "error" : "success",
  });

  await notify({
    workspaceId,
    userId,
    kind: status === "FAILED" ? "RUN_FAILED" : "RUN_COMPLETED",
    title: status === "FAILED" ? "Run finished with failures" : headline,
    body: result.summary,
    href: `/runs/${runId}`,
    metadata: { intentId, artifactId: artifact.id } as Prisma.InputJsonValue,
  });

  await emit(runId, intentId, "VALIDATION_COMPLETED", "Validation completed", { checks: checks.length, recommendations: recommendations.length });
  await emit(runId, intentId, "RESULT_READY", headline, {
    tasks: result.tasks.total,
    recommendations: result.recommendations.length,
    approvals: result.approvals.pending,
    artifactId: artifact.id,
  });

  log.info(`run ${runId} finalized: ${status}`);
  return result;
}

function buildSummary(args: { intent: { objective: string; deadlineText: string | null }; status: string; taskCount: number; recommendations: number; pending: number }) {
  const parts = [`NEXUS completed a ${args.intent.objective} run`];
  if (args.intent.deadlineText) parts.push(`targeting ${args.intent.deadlineText}`);
  parts.push(`with ${args.taskCount} task(s) in scope`);
  if (args.recommendations) parts.push(`${args.recommendations} recommendation(s)`);
  if (args.pending) parts.push(`${args.pending} action(s) awaiting approval`);
  if (args.status === "PARTIAL") parts.push("(partial: some steps failed and were contained)");
  return `${parts.join(" ")}.`;
}

function renderPlanMarkdown(args: {
  intent: { rawInput: string; objective: string; deadlineText: string | null; desiredOutcome: string };
  result: RunResult;
  sequenced: Array<{ title: string; proposedDueDate: string | null }>;
  checks: Array<{ name: string; status: string; detail: string }>;
  findings: Array<{ claim: string; confidence: number; evidence?: Array<{ sourceTitle?: string }> }>;
  executions: Array<{ toolKey: string; status: string; durationMs: number | null }>;
}) {
  const { intent, result, sequenced, checks, findings, executions } = args;
  const lines: string[] = [];
  lines.push(`# ${result.headline}`, "");
  lines.push(`**Request:** ${intent.rawInput}`, "");
  lines.push(`**Objective:** ${intent.objective}${intent.deadlineText ? ` · **Deadline:** ${intent.deadlineText}` : ""}`, "");
  lines.push(`**Outcome:** ${intent.desiredOutcome}`, "");
  lines.push("---", "");

  if (result.tasks.titles.length) {
    lines.push("## Plan", "");
    result.tasks.titles.forEach((title, i) => {
      const due = sequenced.find((s) => s.title === title)?.proposedDueDate;
      lines.push(`${i + 1}. ${title}${due ? ` — ${due.slice(0, 10)}` : ""}`);
    });
    lines.push("");
  }

  if (findings.length) {
    lines.push("## Evidence", "");
    for (const f of findings) {
      lines.push(`- ${f.claim} _(confidence ${f.confidence.toFixed(2)}, source: ${f.evidence?.[0]?.sourceTitle ?? "workspace"})_`);
    }
    lines.push("");
  }

  if (checks.length) {
    lines.push("## Validation", "");
    lines.push("| Check | Status | Detail |", "| --- | --- | --- |");
    for (const c of checks) lines.push(`| ${c.name} | ${c.status} | ${c.detail} |`);
    lines.push("");
  }

  if (result.recommendations.length) {
    lines.push("## Recommendations", "");
    result.recommendations.forEach((r, i) => lines.push(`${i + 1}. **${r.title}** — ${r.detail}`));
    lines.push("");
  }

  lines.push("## Execution", "");
  lines.push(`- Agents: ${result.agentRuns}`);
  lines.push(`- Tool calls: ${result.toolCalls}`);
  lines.push(`- Approvals: ${result.approvals.approved} approved, ${result.approvals.denied} denied, ${result.approvals.pending} pending`);
  lines.push(`- Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  lines.push("");
  if (executions.length) {
    lines.push("| Tool | Status | Duration |", "| --- | --- | --- |");
    for (const e of executions) lines.push(`| ${e.toolKey} | ${e.status} | ${e.durationMs ?? 0}ms |`);
  }
  lines.push("", "_Generated by NEXUS from workspace data. No content in this document was invented._");
  return lines.join("\n");
}
