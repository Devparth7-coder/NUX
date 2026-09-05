import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { queue } from "@/lib/jobs/queue";
import { bus } from "@/lib/events/bus";
import { getAgent } from "@/lib/agents/registry";
import type { AgentContext, ParsedIntent } from "@/lib/agents/types";
import { buildContext, type ContextBundle } from "@/lib/retrieval/context-engine";
import { prepareToolCall, runToolExecution } from "@/lib/tools/registry";
import { notify, recordActivity } from "@/server/services/activity";

export type WFNode = {
  id: string;
  key: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
};

type WFState = {
  cursor: string | null;
  ctx: Record<string, unknown>;
  log: Array<{ nodeId: string; label: string; type: string; status: string; detail?: string; at: string }>;
  halted?: boolean;
};

/**
 * Workflow interpreter: walks the saved DAG node by node, reusing the same
 * agents, tools, permission checks and approval gates as the intent pipeline.
 * State is persisted after every node so runs can halt (approval/delay) and
 * resume without losing progress.
 */
export async function executeWorkflow(workflowRunId: string) {
  const run = await prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
    include: { workflow: { include: { nodes: true, edges: true } } },
  });
  if (!run || run.status === "CANCELLED") return;

  const nodes = run.workflow.nodes as unknown as WFNode[];
  const edges = run.workflow.edges;
  const state = ((run.output as WFState | null) ?? {}) as WFState;
  state.log = state.log ?? [];
  state.ctx = { ...(run.input as Record<string, unknown> ?? {}), ...(state.ctx ?? {}) };

  if (!state.cursor) {
    const trigger = nodes.find((n) => n.type === "TRIGGER");
    state.cursor = trigger?.id ?? nodes[0]?.id ?? null;
  }

  await prisma.workflowRun.update({ where: { id: run.id }, data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() } });
  await recordActivity({
    workspaceId: run.workspaceId,
    userId: run.userId,
    kind: "WORKFLOW",
    action: "workflow.run",
    summary: `Workflow “${run.workflow.name}” started`,
    entityType: "WORKFLOW",
    entityId: run.workflowId,
    status: "info",
  });

  let guard = 0;
  while (state.cursor && guard++ < 100) {
    const node = nodes.find((n) => n.id === state.cursor);
    if (!node) break;

    const outcome = await runNode({ node, state, run: { id: run.id, workspaceId: run.workspaceId, userId: run.userId, workflowId: run.workflowId } });

    state.log.push({
      nodeId: node.id,
      label: node.label,
      type: node.type,
      status: outcome.status,
      detail: outcome.detail,
      at: new Date().toISOString(),
    });

    if (outcome.status === "HALTED") {
      await persist(run.id, state, "WAITING_APPROVAL");
      bus.publish(`workspace:${run.workspaceId}`, "workflow.updated", "Workflow waiting for approval", { runId: run.id });
      return;
    }
    if (outcome.status === "DELAYED") {
      await persist(run.id, state, "RUNNING");
      queue.enqueue(
        "workflow.resume",
        { workflowRunId: run.id },
        { delayMs: Number((node.config.delayMs as number) ?? 5000), maxAttempts: 2 },
      );
      return;
    }
    if (outcome.status === "FAILED") {
      await persist(run.id, state, "FAILED");
      await prisma.workflowRun.update({ where: { id: run.id }, data: { error: outcome.detail ?? "Node failed", completedAt: new Date() } });
      await notify({
        workspaceId: run.workspaceId,
        userId: run.userId,
        kind: "RUN_FAILED",
        title: "Workflow failed",
        body: `${node.label}: ${outcome.detail ?? "failed"}`,
        href: `/workflows/${run.workflowId}`,
      });
      return;
    }

    const nextEdges = edges.filter((e) => e.sourceId === node.id);
    let nextId: string | null = nextEdges[0]?.targetId ?? null;

    if (node.type === "CONDITION" || node.type === "BRANCH") {
      const branch = outcome.status === "TRUE" ? "true" : "false";
      const matched = nextEdges.find((e) => (e.label ?? e.condition ?? "").toLowerCase() === branch) ?? nextEdges[0];
      nextId = matched?.targetId ?? null;
    }

    state.cursor = nextId;
    await persist(run.id, state, "RUNNING");
  }

  await prisma.workflowRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date(), output: state as never } });
  await recordActivity({
    workspaceId: run.workspaceId,
    userId: run.userId,
    kind: "WORKFLOW",
    action: "workflow.completed",
    summary: `Workflow “${run.workflow.name}” completed`,
    entityType: "WORKFLOW",
    entityId: run.workflowId,
    status: "success",
  });
  await notify({
    workspaceId: run.workspaceId,
    userId: run.userId,
    kind: "WORKFLOW_COMPLETED",
    title: "Workflow completed",
    body: `${run.workflow.name} finished ${state.log.length} step(s).`,
    href: `/workflows/${run.workflowId}`,
  });
  bus.publish(`workspace:${run.workspaceId}`, "workflow.updated", "Workflow completed", { runId: run.id });
}

type NodeOutcome = { status: "OK" | "TRUE" | "FALSE" | "FAILED" | "HALTED" | "DELAYED"; detail?: string };

async function runNode(args: {
  node: WFNode;
  state: WFState;
  run: { id: string; workspaceId: string; userId: string; workflowId: string };
}): Promise<NodeOutcome> {
  const { node, state, run } = args;

  switch (node.type) {
    case "TRIGGER":
      return { status: "OK", detail: `Triggered with ${Object.keys(state.ctx).length} input key(s)` };

    case "AGENT": {
      const agentKey = String(node.config.agentKey ?? "");
      const agent = getAgent(agentKey);
      if (!agent) return { status: "FAILED", detail: `Unknown agent "${agentKey}"` };

      const intent = syntheticIntent(state);
      const context = await buildContext({
        workspaceId: run.workspaceId,
        userId: run.userId,
        query: String(state.ctx.query ?? intent.desiredOutcome ?? agentKey),
        projectId: (state.ctx.projectId as string | null) ?? null,
        limit: 8,
      });

      const runRow = await prisma.agentRun.create({
        data: {
          workspaceId: run.workspaceId,
          userId: run.userId,
          projectId: (state.ctx.projectId as string | null) ?? null,
          key: agent.key,
          name: agent.name,
          status: "RUNNING",
          startedAt: new Date(),
          input: { workflowRunId: run.id, nodeId: node.id } as Prisma.InputJsonValue,
        },
      });

      const ctx: AgentContext = {
        runId: runRow.id,
        graphRunId: run.id,
        workspaceId: run.workspaceId,
        userId: run.userId,
        intentId: "",
        projectId: (state.ctx.projectId as string | null) ?? null,
        intent,
        context,
        priorOutputs: {},
        runInput: { workflowRunId: run.id, nodeId: node.id },
        autoApproveRead: true,
        stepId: node.id,
        log: () => undefined,
      };

      const started = Date.now();
      const result = await agent.run(ctx);
      await prisma.agentRun.update({
        where: { id: runRow.id },
        data: {
          status: result.status as never,
          outputs: result.output as never,
          latencyMs: Date.now() - started,
          completedAt: new Date(),
        },
      });
      state.ctx[node.key] = result.output;
      if (result.status === "WAITING_APPROVAL") return { status: "HALTED", detail: "Approval required" };
      if (result.status === "FAILED") return { status: "FAILED", detail: result.error ?? result.summary };
      return { status: "OK", detail: result.summary };
    }

    case "TOOL": {
      const toolKey = String(node.config.toolKey ?? "");
      const input = resolveTemplate(node.config.toolInput ?? {}, state.ctx);
      const prepared = await prepareToolCall({
        key: toolKey,
        input,
        ctx: { workspaceId: run.workspaceId, userId: run.userId, projectId: (state.ctx.projectId as string | null) ?? null, runId: run.id },
        autoApproveRead: true,
      });

      const execution = await prisma.toolExecution.create({
        data: {
          workspaceId: run.workspaceId,
          runId: null,
          toolKey,
          status: prepared.decision.requiresApproval ? "AWAITING_APPROVAL" : "PENDING",
          input: prepared.input as Prisma.InputJsonValue,
          permissionLevel: prepared.permissionLevel,
          requiresApproval: prepared.decision.requiresApproval,
        },
      });

      if (prepared.decision.requiresApproval) {
        await prisma.approval.create({
          data: {
            workspaceId: run.workspaceId,
            toolExecutionId: execution.id,
            toolKey,
            title: prepared.summary,
            whatHappens: prepared.summary,
            whyNeeded: `Workflow “${node.label}” requires approval. ${prepared.decision.reason}`,
            affectedData: prepared.affectedData as Prisma.InputJsonValue,
            permissionLevel: prepared.permissionLevel,
            payload: { input: prepared.input, workflowRunId: run.id, nodeId: node.id } as Prisma.InputJsonValue,
          },
        });
        return { status: "HALTED", detail: "Approval required" };
      }

      try {
        const output = await runToolExecution(execution.id, {
          workspaceId: run.workspaceId,
          userId: run.userId,
          projectId: (state.ctx.projectId as string | null) ?? null,
        });
        state.ctx[node.key] = output ?? null;
        return { status: "OK", detail: prepared.summary };
      } catch (err) {
        return { status: "FAILED", detail: err instanceof Error ? err.message : String(err) };
      }
    }

    case "CONDITION":
    case "BRANCH": {
      const expression = String(node.config.expression ?? "true");
      const result = evaluateCondition(expression, state.ctx);
      return { status: result ? "TRUE" : "FALSE", detail: `${expression} → ${result}` };
    }

    case "APPROVAL": {
      // An explicit approval gate always stops the run the first time it is reached.
      const existing = await prisma.approval.findFirst({
        where: { payload: { path: ["workflowRunId"], equals: run.id } },
        orderBy: { createdAt: "desc" },
      });
      if (!existing) {
        await prisma.approval.create({
          data: {
            workspaceId: run.workspaceId,
            toolKey: "workflow.approval",
            title: node.label,
            whatHappens: `Continue the workflow past “${node.label}”`,
            whyNeeded: "This workflow contains an explicit approval gate, so execution stops until you decide.",
            affectedData: { workflow: run.workflowId, node: node.key } as Prisma.InputJsonValue,
            permissionLevel: (node.config.permission as "WRITE" | "HIGH_IMPACT") ?? "WRITE",
            payload: { workflowRunId: run.id, nodeId: node.id } as Prisma.InputJsonValue,
            requestedBy: "workflow",
          },
        });
        await notify({
          workspaceId: run.workspaceId,
          userId: run.userId,
          kind: "APPROVAL_REQUIRED",
          title: "Workflow paused for approval",
          body: node.label,
          href: `/workflows/${run.workflowId}`,
        });
        return { status: "HALTED", detail: "Approval required" };
      }
      if (existing.status === "DENIED") return { status: "FAILED", detail: "Approval denied" };
      if (existing.status !== "APPROVED") return { status: "HALTED", detail: "Approval required" };
      return { status: "OK", detail: "Approval granted" };
    }

    case "DELAY":
      return { status: "DELAYED", detail: `Delaying ${Number(node.config.delayMs ?? 5000)}ms` };

    case "LOOP": {
      const items = resolvePath(String(node.config.loopOver ?? "items"), state.ctx);
      const list = Array.isArray(items) ? items : [];
      state.ctx[`${node.key}_count`] = list.length;
      return { status: list.length > 0 ? "TRUE" : "FALSE", detail: `${list.length} item(s)` };
    }

    case "OUTPUT":
      state.ctx.output = { collectedAt: new Date().toISOString(), keys: Object.keys(state.ctx).length };
      return { status: "OK", detail: "Output collected" };

    default:
      return { status: "OK", detail: `Skipped unknown node type ${node.type}` };
  }
}

function syntheticIntent(state: WFState): ParsedIntent {
  return {
    objective: String(state.ctx.objective ?? "workflow"),
    desiredOutcome: String(state.ctx.desiredOutcome ?? state.ctx.query ?? "Complete the workflow objective"),
    entities: [],
    constraints: [],
    deadlineText: (state.ctx.deadlineText as string | null) ?? null,
    deadline: (state.ctx.deadline as string | null) ?? null,
    projectContext: null,
    requiredCapabilities: [],
    riskLevel: "LOW",
    permissionsRequired: ["READ"],
    confidence: 0.7,
    reasoningSummary: "Synthetic intent for workflow execution",
  };
}

/** Minimal, safe expression evaluator — no eval, no arbitrary code. */
export function evaluateCondition(expression: string, ctx: Record<string, unknown>): boolean {
  const match = expression.match(/^\s*([\w.]+)\s*(>=|<=|==|!=|>|<|contains)\s*(.+?)\s*$/);
  if (!match) return expression.trim().toLowerCase() === "true";
  const [, leftRaw, op, rightRaw] = match;
  const left = resolvePath(leftRaw, ctx);
  const right = parseLiteral(rightRaw);

  if (op === "contains") {
    if (Array.isArray(left)) return left.includes(right);
    return String(left ?? "").toLowerCase().includes(String(right).toLowerCase());
  }
  const l = typeof left === "number" ? left : Number(String(left ?? ""));
  const r = typeof right === "number" ? right : Number(String(right ?? ""));
  const bothNumeric = Number.isFinite(l) && Number.isFinite(r);
  switch (op) {
    case ">":
      return bothNumeric ? l > r : String(left) > String(right);
    case "<":
      return bothNumeric ? l < r : String(left) < String(right);
    case ">=":
      return bothNumeric ? l >= r : String(left) >= String(right);
    case "<=":
      return bothNumeric ? l <= r : String(left) <= String(right);
    case "==":
      return String(left) === String(right);
    case "!=":
      return String(left) !== String(right);
    default:
      return false;
  }
}

function parseLiteral(raw: string): unknown {
  const value = raw.trim().replace(/^['"]|['"]$/g, "");
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const num = Number(value);
  return Number.isFinite(num) && value !== "" ? num : value;
}

function resolvePath(path: string, ctx: Record<string, unknown>): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, ctx);
}

function resolveTemplate<T>(value: T, ctx: Record<string, unknown>): T {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => String(resolvePath(path, ctx) ?? "")) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplate(v, ctx)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveTemplate(v, ctx)])) as unknown as T;
  }
  return value;
}

async function persist(workflowRunId: string, state: WFState, status: "RUNNING" | "WAITING_APPROVAL" | "FAILED") {
  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: { output: state as never, status: status as never },
  });
}

queue.register("workflow.run", async (payload: { workflowRunId: string }) => {
  await executeWorkflow(payload.workflowRunId);
});

queue.register("workflow.resume", async (payload: { workflowRunId: string }) => {
  await executeWorkflow(payload.workflowRunId);
});

export async function resumeWorkflowRun(workflowRunId: string) {
  queue.enqueue("workflow.resume", { workflowRunId }, { maxAttempts: 2 });
}

log.debug("workflow engine loaded");
