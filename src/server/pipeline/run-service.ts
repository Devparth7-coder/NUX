import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { queue } from "@/lib/jobs/queue";
import { bus, publishRunEvent } from "@/lib/events/bus";
import { buildContext, type ContextBundle } from "@/lib/retrieval/context-engine";
import { defaultGraph, emit, executeGraph, planExecutionGraph } from "@/lib/orchestration/engine";
import { parseAndStoreIntent } from "./intent-engine";
import { finalizeRun } from "./finalize";
import type { ParsedIntent } from "@/lib/agents/types";
import { notify, recordActivity } from "@/server/services/activity";

// Background job: executing an intent's agent graph. Registered here so the
// handler exists wherever the pipeline is used (server, tests, scripts).
queue.register(
  "run.graph",
  async (payload: { runId: string; workspaceId: string; intentId: string; userId: string; autoApproveRead: boolean }) => {
    await runGraphJob(payload);
  },
);

export type StartRunInput = {
  workspaceId: string;
  userId: string;
  rawInput: string;
  conversationId?: string | null;
  autoApproveRead: boolean;
  projectId?: string | null;
};

export type StartRunResult = {
  intentId: string;
  runId: string;
  intent: ParsedIntent;
  context: { items: number; confidence: number; sources: Array<{ label: string; count: number }> };
  graph: Array<{ id: string; agent: string; title: string; dependsOn: string[] }>;
};

/**
 * COMMAND → INTENT → CONTEXT → PLAN → (background) ORCHESTRATION.
 * Returns as soon as the plan exists; execution continues in the job runner so
 * the HTTP request never blocks and the UI can stream live events.
 */
export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const { intentId, intent } = await parseAndStoreIntent({
    workspaceId: input.workspaceId,
    userId: input.userId,
    rawInput: input.rawInput,
    conversationId: input.conversationId ?? null,
  });

  const projectId = input.projectId ?? intent.projectContext?.id ?? null;

  await emit(null, intentId, "CONTEXT_RETRIEVED", "Retrieving relevant context", { stage: "context" });
  const context = await buildContext({
    workspaceId: input.workspaceId,
    userId: input.userId,
    query: `${input.rawInput} ${intent.desiredOutcome}`.trim(),
    projectId,
    entityTerms: intent.entities.map((e) => e.name),
    limit: 12,
  });

  await prisma.intent.update({ where: { id: intentId }, data: { status: "PLANNING" } });
  await emit(null, intentId, "CONTEXT_RETRIEVED", `Retrieved ${context.items.length} relevant item(s) (confidence ${context.confidence.toFixed(2)})`, {
    count: context.items.length,
    confidence: context.confidence,
    sources: context.sources,
    topItems: context.items.slice(0, 5).map((i) => ({ title: i.title, source: i.source, score: i.score.total })),
  });

  const graph = await planExecutionGraph({
    workspaceId: input.workspaceId,
    userId: input.userId,
    intentId,
    intent,
    context,
  }).catch((err) => {
    log.warn("graph planning failed, using default graph", err);
    return defaultGraph(intent);
  });

  const run = await prisma.agentRun.create({
    data: {
      workspaceId: input.workspaceId,
      intentId,
      userId: input.userId,
      projectId,
      key: "orchestrator",
      name: "NEXUS Orchestrator",
      status: "QUEUED",
      step: "planned",
      input: { rawInput: input.rawInput, autoApproveRead: input.autoApproveRead },
      context: context as unknown as Prisma.InputJsonValue,
      outputs: { steps: graph.steps.map((s) => ({ id: s.id, agent: s.agent, title: s.title, status: "PENDING", dependsOn: s.dependsOn })), outputs: {} } as Prisma.InputJsonValue,
    },
  });

  await prisma.intent.update({ where: { id: intentId }, data: { status: "EXECUTING" } });
  await recordActivity({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId,
    intentId,
    kind: "AGENT",
    action: "intent.start",
    summary: `Started: ${input.rawInput.slice(0, 80)}`,
    detail: { intentId, runId: run.id },
    entityType: "INTENT",
    entityId: intentId,
    status: "info",
  });

  queue.enqueue(
    "run.graph",
    { runId: run.id, workspaceId: input.workspaceId, intentId, userId: input.userId, autoApproveRead: input.autoApproveRead },
    { maxAttempts: 3 },
  );

  return {
    intentId,
    runId: run.id,
    intent,
    context: { items: context.items.length, confidence: context.confidence, sources: context.sources },
    graph: graph.steps.map((s) => ({ id: s.id, agent: s.agent, title: s.title, dependsOn: s.dependsOn })),
  };
}

export type GraphJobPayload = {
  runId: string;
  workspaceId: string;
  intentId: string;
  userId: string;
  autoApproveRead: boolean;
};

/** Job handler: executes (or resumes) the DAG and finalizes when it completes. */
export async function runGraphJob(payload: GraphJobPayload) {
  const run = await prisma.agentRun.findUnique({ where: { id: payload.runId } });
  if (!run || run.status === "CANCELLED") return;

  const intentRow = await prisma.intent.findUnique({ where: { id: payload.intentId } });
  if (!intentRow) return;

  const intent: ParsedIntent = {
    objective: intentRow.objective,
    desiredOutcome: intentRow.desiredOutcome,
    entities: (intentRow.entities as unknown as ParsedIntent["entities"]) ?? [],
    constraints: (intentRow.constraints as unknown as string[]) ?? [],
    deadlineText: intentRow.deadlineText,
    deadline: intentRow.deadline?.toISOString() ?? null,
    projectContext: intentRow.projectId ? { id: intentRow.projectId, name: "" } : null,
    requiredCapabilities: (intentRow.capabilities as string[]) ?? [],
    riskLevel: intentRow.riskLevel,
    permissionsRequired: (intentRow.permissions as string[]) ?? [],
    confidence: intentRow.confidence,
    reasoningSummary: "",
  };

  const storedContext = run.context as unknown as ContextBundle | null;
  const context: ContextBundle =
    storedContext && Array.isArray(storedContext.items)
      ? storedContext
      : await buildContext({
          workspaceId: payload.workspaceId,
          userId: payload.userId,
          query: `${intentRow.rawInput} ${intentRow.desiredOutcome}`.trim(),
          projectId: intentRow.projectId,
          entityTerms: intent.entities.map((e) => e.name),
        });

  const graph = (run.outputs as { plan?: { steps: unknown[] } } | null)?.plan as never;

  const result = await executeGraph({
    graphRunId: payload.runId,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    intentId: payload.intentId,
    projectId: intentRow.projectId,
    intent,
    context,
    graph: graph ?? defaultGraph(intent),
    autoApproveRead: payload.autoApproveRead,
  });

  if (result.status === "COMPLETED" || result.status === "PARTIAL" || result.status === "FAILED") {
    await finalizeRun({ runId: payload.runId, intentId: payload.intentId, workspaceId: payload.workspaceId, userId: payload.userId, status: result.status });
  }
}

/** Called by the approval service after a human decision. */
export async function resumeRun(runId: string, userId: string, autoApproveRead: boolean) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run || !run.intentId) return;
  queue.enqueue(
    "run.graph",
    { runId, workspaceId: run.workspaceId, intentId: run.intentId, userId, autoApproveRead },
    { maxAttempts: 2 },
  );
  publishRunEvent(runId, run.intentId, "AGENT_STARTED", "Resuming execution", { resumed: true });
}

export async function cancelRun(runId: string, userId: string) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  queue.cancel(`run:${runId}`);
  const updated = await prisma.agentRun.update({
    where: { id: runId },
    data: { status: "CANCELLED", completedAt: new Date(), step: "cancelled" },
  });
  await prisma.agentRun.updateMany({
    where: { parentRunId: runId, status: { in: ["QUEUED", "RUNNING", "WAITING_APPROVAL"] } },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
  if (run.intentId) {
    await prisma.intent.update({ where: { id: run.intentId }, data: { status: "CANCELLED" } });
    await emit(runId, run.intentId, "ERROR", "Run cancelled by user", { userId });
  }
  await recordActivity({
    workspaceId: run.workspaceId,
    userId,
    projectId: run.projectId,
    kind: "AGENT",
    action: "run.cancel",
    summary: "Run cancelled",
    detail: { runId },
    entityType: "RUN",
    entityId: runId,
    status: "warning",
  });
  bus.publish(`workspace:${run.workspaceId}`, "run.updated", "Run cancelled", { runId });
  return updated;
}

/** Re-runs a failed run from its persisted graph state. */
export async function retryRun(runId: string, userId: string, autoApproveRead: boolean) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run || !run.intentId) return null;
  const outputs = run.outputs as { steps?: Array<{ id: string; status: string }> } | null;
  const steps = (outputs?.steps ?? []).map((s) => (s.status === "FAILED" || s.status === "SKIPPED" ? { ...s, status: "PENDING" } : s));
  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: "QUEUED", error: null, errorDetail: undefined, outputs: { ...(outputs ?? {}), steps } as never },
  });
  await resumeRun(runId, userId, autoApproveRead);
  await notify({
    workspaceId: run.workspaceId,
    userId,
    kind: "RUN_COMPLETED",
    title: "Run queued for retry",
    body: "NEXUS will retry the failed steps and preserve completed work.",
    href: `/runs/${runId}`,
  });
  return run;
}
