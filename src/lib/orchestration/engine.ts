import { z } from "zod";
import type { Prisma, RunStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { bus, publishRunEvent } from "@/lib/events/bus";
import { completeWithTelemetry } from "@/lib/ai";
import { getAgent, AGENTS, type AgentKey } from "@/lib/agents/registry";
import type { AgentContext, ParsedIntent } from "@/lib/agents/types";
import type { ContextBundle } from "@/lib/retrieval/context-engine";
import { topoLevels, validateGraph, type ExecutionGraph } from "./graph";
import { pace } from "./pacing";

const GraphSchema = z.object({
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
    .min(1),
});

export type StepState = {
  id: string;
  agent: string;
  title: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED" | "WAITING_APPROVAL";
  runId?: string;
  error?: string;
  dependsOn?: string[];
};

export type GraphState = {
  steps: StepState[];
  outputs: Record<string, Record<string, unknown>>;
  plan: ExecutionGraph;
};

export type GraphRunResult = {
  status: "COMPLETED" | "WAITING_APPROVAL" | "PARTIAL" | "FAILED" | "CANCELLED";
  state: GraphState;
};

/** Persists an execution event and pushes it to live subscribers. */
export async function emit(runId: string | null, intentId: string | null, kind: string, message: string, detail?: Record<string, unknown>) {
  try {
    await prisma.runEvent.create({
      data: { runId: runId ?? null, intentId, kind: kind as never, message, detail: (detail ?? {}) as Prisma.InputJsonValue },
    });
  } catch (err) {
    log.warn("failed to persist run event", err);
  }
  if (runId) publishRunEvent(runId, intentId, kind, message, detail);
  else if (intentId) bus.publish(`intent:${intentId}`, kind, message, detail);
}

/**
 * Builds the execution DAG for an intent: which agents run, in what order,
 * and what each depends on. Validated before execution and repaired with a
 * known-good fallback if the model returns an unusable graph.
 */
export async function planExecutionGraph(args: {
  workspaceId: string;
  userId: string;
  intentId: string;
  intent: ParsedIntent;
  context: ContextBundle;
}): Promise<ExecutionGraph> {
  const completion = await completeWithTelemetry<z.infer<typeof GraphSchema>>(
    {
      purpose: "plan.create",
      system:
        "You build an agent execution graph. Choose only from the available agents. Return a DAG where every step id is unique and dependencies reference existing ids.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            intent: args.intent,
            availableAgents: Object.keys(AGENTS),
            contextSummary: {
              items: args.context.items.length,
              openTasks: args.context.openTasks.length,
              documents: args.context.documents.length,
            },
          }),
        },
      ],
      schema: GraphSchema,
      metadata: {
        intent: args.intent,
        existingTasks: args.context.openTasks,
        documentCount: args.context.documents.length,
        runId: null,
        intentId: args.intentId,
      },
    },
    { workspaceId: args.workspaceId },
  );

  const raw = completion.data;
  const graph: ExecutionGraph = {
    steps: (raw?.steps ?? []).map((s) => ({
      id: s.id,
      agent: s.agent,
      title: s.title,
      capability: s.capability,
      dependsOn: s.dependsOn,
    })),
    createdAt: new Date().toISOString(),
  };

  const validation = validateGraph(graph);
  if (!validation.ok) {
    log.warn(`invalid execution graph (${validation.errors.join("; ")}) — using default graph`);
    return defaultGraph(args.intent);
  }
  // Every step must map to a registered agent.
  const unmapped = graph.steps.filter((s) => !getAgent(s.agent));
  if (unmapped.length) {
    log.warn(`graph referenced unknown agents: ${unmapped.map((s) => s.agent).join(", ")}`);
    return defaultGraph(args.intent);
  }
  return graph;
}

export function defaultGraph(intent: ParsedIntent): ExecutionGraph {
  const capabilities = intent.requiredCapabilities;
  const steps: ExecutionGraph["steps"] = [
    { id: "step-plan", agent: "planning", title: "Decompose objective", capability: "planning", dependsOn: [] },
  ];
  const parallel: string[] = [];

  if (capabilities.includes("research") || capabilities.includes("document_analysis") || ["launch", "analyze", "research"].includes(intent.objective)) {
    steps.push({ id: "step-research", agent: "research", title: "Collect evidence", capability: "research", dependsOn: ["step-plan"] });
    parallel.push("step-research");
  }
  steps.push({ id: "step-knowledge", agent: "knowledge", title: "Structure knowledge", capability: "knowledge", dependsOn: ["step-plan"] });
  parallel.push("step-knowledge");

  if (capabilities.includes("analysis")) {
    steps.push({ id: "step-analyst", agent: "analyst", title: "Quantify delivery", capability: "analysis", dependsOn: ["step-plan"] });
  }

  steps.push({
    id: "step-execution",
    agent: "execution",
    title: "Execute permitted actions",
    capability: "execution",
    dependsOn: ["step-plan", ...parallel],
  });

  const preReview = ["step-execution"];
  if (capabilities.includes("content")) {
    steps.push({ id: "step-creative", agent: "creative", title: "Draft communication", capability: "content", dependsOn: ["step-execution"] });
    preReview.push("step-creative");
  }
  steps.push({ id: "step-review", agent: "review", title: "Validate results", capability: "review", dependsOn: preReview });

  return { steps, createdAt: new Date().toISOString() };
}

/**
 * Executes the DAG: parallel branches run concurrently, dependents wait,
 * approvals halt the run, failures are contained to their branch.
 */
export async function executeGraph(args: {
  graphRunId: string;
  workspaceId: string;
  userId: string;
  intentId: string;
  projectId: string | null;
  intent: ParsedIntent;
  context: ContextBundle;
  graph: ExecutionGraph;
  autoApproveRead: boolean;
}): Promise<GraphRunResult> {
  const { graphRunId, workspaceId, userId, intentId, projectId, intent, context, graph, autoApproveRead } = args;

  const parent = await prisma.agentRun.findUnique({ where: { id: graphRunId } });
  if (!parent) throw new Error("Orchestrator run not found");
  if (parent.status === "CANCELLED") return { status: "CANCELLED", state: readState(parent.outputs, graph) };

  const state: GraphState = readState(parent.outputs, graph);
  state.plan = graph;

  await prisma.agentRun.update({ where: { id: graphRunId }, data: { status: "RUNNING", startedAt: parent.startedAt ?? new Date(), step: "executing" } });
  await emit(graphRunId, intentId, "PLAN_CREATED", `Execution plan created with ${graph.steps.length} step(s)`, {
    steps: graph.steps.map((s) => ({ id: s.id, agent: s.agent })),
  });

  const levels = topoLevels(graph);
  let haltedForApproval = false;

  for (const level of levels) {
    if (haltedForApproval) break;

    const current = await prisma.agentRun.findUnique({ where: { id: graphRunId }, select: { status: true } });
    if (current?.status === "CANCELLED") return { status: "CANCELLED", state };

    const runnable = level
      .map((id) => state.steps.find((s) => s.id === id)!)
      .filter((s) => s && s.status !== "COMPLETED" && s.status !== "SKIPPED");

    if (!runnable.length) continue;

    const results = await Promise.all(
      runnable.map((step) =>
        runStep({
          step,
          state,
          workspaceId,
          userId,
          intentId,
          projectId: projectId ?? intent.projectContext?.id ?? null,
          intent,
          context,
          graphRunId,
          autoApproveRead,
        }),
      ),
    );

    for (const result of results) {
      const step = state.steps.find((s) => s.id === result.stepId)!;
      step.status = result.status;
      step.runId = result.runId;
      step.error = result.error;
      if (result.output) state.outputs[result.stepId] = result.output;

      if (result.status === "WAITING_APPROVAL") haltedForApproval = true;
      if (result.status === "FAILED") {
        // Contain the failure: dependents are skipped, siblings continue.
        for (const s of state.steps) {
          if (s.dependsOn?.includes(result.stepId) || s.id === result.stepId) continue;
          if (dependsOnTransitively(graph, s.id, result.stepId)) s.status = "SKIPPED";
        }
      }
    }

    await persistState(graphRunId, state);
    await pace(1);
  }

  const terminal = summarize(state, haltedForApproval);
  await prisma.agentRun.update({
    where: { id: graphRunId },
    data: {
      status: terminal as RunStatus,
      step: terminal === "COMPLETED" ? "completed" : terminal.toLowerCase(),
      completedAt: terminal === "COMPLETED" || terminal === "PARTIAL" || terminal === "FAILED" ? new Date() : null,
      progress: computeProgress(state),
      outputs: state as never,
      latencyMs: Date.now() - (parent.startedAt?.getTime() ?? Date.now()),
    },
  });

  if (terminal === "COMPLETED" || terminal === "PARTIAL") {
    await emit(graphRunId, intentId, "RESULT_READY", "Execution finished", { status: terminal });
  }
  bus.publish(`workspace:${workspaceId}`, "run.updated", `Run ${terminal}`, { runId: graphRunId, intentId });
  return { status: terminal, state };
}

type StepRunResult = {
  stepId: string;
  status: StepState["status"];
  runId: string;
  output?: Record<string, unknown>;
  error?: string;
};

async function runStep(args: {
  step: StepState;
  state: GraphState;
  workspaceId: string;
  userId: string;
  intentId: string;
  projectId: string | null;
  intent: ParsedIntent;
  context: ContextBundle;
  graphRunId: string;
  autoApproveRead: boolean;
}): Promise<StepRunResult> {
  const { step, state, workspaceId, userId, intentId, projectId, intent, context, graphRunId, autoApproveRead } = args;
  const agent = getAgent(step.agent as AgentKey);
  if (!agent) {
    return { stepId: step.id, status: "FAILED", runId: "", error: `Unknown agent ${step.agent}` };
  }

  const agentRow = await prisma.agent.findUnique({
    where: { workspaceId_key: { workspaceId, key: agent.key } },
    select: { id: true },
  });

  const existing = step.runId
    ? await prisma.agentRun.findUnique({ where: { id: step.runId } })
    : await prisma.agentRun.findFirst({
        where: { parentRunId: graphRunId, key: agent.key, intentId },
        orderBy: { createdAt: "desc" },
      });

  const run =
    existing ??
    (await prisma.agentRun.create({
      data: {
        workspaceId,
        intentId,
        agentId: agentRow?.id ?? null,
        parentRunId: graphRunId,
        userId,
        projectId,
        key: agent.key,
        name: agent.name,
        status: "QUEUED",
        input: { step: step.id },
      },
    }));

  const startedAt = Date.now();
  await prisma.agentRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: new Date(), step: "running" },
  });
  await emit(run.id, intentId, "AGENT_SELECTED", `${agent.name} selected`, { agent: agent.key });
  await emit(run.id, intentId, "AGENT_STARTED", `${agent.name} started`, { agent: agent.key, step: step.id });

  const ctx: AgentContext = {
    runId: run.id,
    graphRunId,
    workspaceId,
    userId,
    intentId,
    projectId,
    intent,
    context,
    priorOutputs: state.outputs,
    runInput: (run.input as Record<string, unknown>) ?? {},
    autoApproveRead,
    stepId: step.id,
    log: (message, detail) => {
      void emit(run.id, intentId, "AGENT_PROGRESS", message, detail);
    },
  };

  try {
    const result = await agent.run(ctx);
    const latencyMs = Date.now() - startedAt;

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: result.status as RunStatus,
        outputs: result.output as never,
        tokensIn: result.tokensIn ?? 0,
        tokensOut: result.tokensOut ?? 0,
        costUsd: result.costUsd ?? 0,
        latencyMs,
        progress: result.status === "COMPLETED" ? 100 : 60,
        step: result.status.toLowerCase(),
        completedAt: ["COMPLETED", "FAILED", "PARTIAL"].includes(result.status) ? new Date() : null,
        error: result.error ?? null,
        errorDetail: result.errorDetail as never,
        context: { items: context.items.length, confidence: context.confidence } as never,
      },
    });

    if (agentRow) {
      await prisma.agent.update({
        where: { id: agentRow.id },
        data: {
          totalRuns: { increment: 1 },
          successRuns: result.status === "COMPLETED" ? { increment: 1 } : undefined,
          totalLatencyMs: { increment: latencyMs },
          totalTokens: { increment: (result.tokensIn ?? 0) + (result.tokensOut ?? 0) },
          totalCostUsd: { increment: result.costUsd ?? 0 },
          lastRunAt: new Date(),
        },
      });
    }

    if (result.status === "COMPLETED") {
      await emit(run.id, intentId, "AGENT_COMPLETED", `${agent.name} completed — ${result.summary}`, { summary: result.summary });
    } else if (result.status === "WAITING_APPROVAL") {
      await emit(run.id, intentId, "APPROVAL_REQUESTED", `${agent.name} is waiting for approval`, {
        approvals: result.approvalIds ?? [],
      });
    } else {
      await emit(run.id, intentId, "AGENT_FAILED", `${agent.name} failed — ${result.summary}`, { error: result.error });
    }

    return {
      stepId: step.id,
      status: result.status === "WAITING_APPROVAL" ? "WAITING_APPROVAL" : result.status === "COMPLETED" ? "COMPLETED" : result.status === "PARTIAL" ? "COMPLETED" : "FAILED",
      runId: run.id,
      output: result.output,
      error: result.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`agent ${agent.key} crashed`, err);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: message,
        completedAt: new Date(),
        latencyMs: Date.now() - startedAt,
      },
    });
    await emit(run.id, intentId, "AGENT_FAILED", `${agent.name} crashed — ${message}`, { error: message });
    return { stepId: step.id, status: "FAILED", runId: run.id, error: message };
  }
}

function dependsOnTransitively(graph: ExecutionGraph, stepId: string, target: string): boolean {
  const step = graph.steps.find((s) => s.id === stepId);
  if (!step) return false;
  if (step.dependsOn.includes(target)) return true;
  return step.dependsOn.some((d) => dependsOnTransitively(graph, d, target));
}

function summarize(state: GraphState, halted: boolean): GraphRunResult["status"] {
  if (halted) return "WAITING_APPROVAL";
  const failed = state.steps.filter((s) => s.status === "FAILED");
  const completed = state.steps.filter((s) => s.status === "COMPLETED");
  if (!completed.length && failed.length) return "FAILED";
  if (failed.length) return "PARTIAL";
  return "COMPLETED";
}

function computeProgress(state: GraphState) {
  const total = state.steps.length || 1;
  const done = state.steps.filter((s) => s.status === "COMPLETED").length;
  return Math.round((done / total) * 100);
}

function readState(outputs: unknown, graph: ExecutionGraph): GraphState {
  const parsed = outputs as Partial<GraphState> | null;
  if (parsed?.steps?.length) {
    return {
      steps: parsed.steps.map((s) => ({
        id: s.id,
        agent: s.agent,
        title: s.title ?? s.id,
        status: s.status === "RUNNING" ? "PENDING" : s.status,
        runId: s.runId,
        error: s.error,
        dependsOn: [],
      })),
      outputs: parsed.outputs ?? {},
      plan: graph,
    };
  }
  return {
    steps: graph.steps.map((s) => ({
      id: s.id,
      agent: s.agent,
      title: s.title,
      status: "PENDING" as const,
      dependsOn: s.dependsOn,
    })),
    outputs: {},
    plan: graph,
  };
}

async function persistState(graphRunId: string, state: GraphState) {
  await prisma.agentRun.update({
    where: { id: graphRunId },
    data: { outputs: state as never, progress: computeProgress(state) },
  });
  bus.publish(`run:${graphRunId}`, "graph.updated", "Execution graph updated", { steps: state.steps });
}
