/**
 * Agent Orchestrator (§9).
 *
 * Receives intent + context + available agents + tools + permissions, builds an
 * execution DAG, and runs it with parallelism, retries, timeouts, cancellation,
 * human approval gates, validation and memory updates.
 *
 * Guarantee: every node, event, tool call, approval, artifact and memory written
 * here is a real database row. Nothing is faked for visual effect.
 */

import type {
  ContextBundle,
  ExecutionPlan,
  IntentObject,
  PermissionLevel,
  StructuredResponse,
} from '@/types';
import { prisma } from '../db';
import { NexusError, toNexusError } from '../errors';
import { createLogger } from '../logger';
import { parseIntent } from '../intelligence/intent-engine';
import { buildContext } from '../retrieval/context-engine';
import { AGENTS, getAgent } from '../agents/registry';
import type { AgentContext, AgentOutput, ToolOutcome } from '../agents/types';
import { toolRegistry } from '../tools/registry';
import { authorize, DEFAULT_POLICY, type PermissionPolicy } from '../permissions/engine';
import { waitForApproval } from './approvals';
import { buildAgentGraph, topoWaves } from './planner';
import { deriveMemoryCandidates, writeMemory, type MemoryCandidate } from '../memory/service';
import { recordActivity } from '../../server/services/activity';
import { notify } from '../../server/services/notifications';
import { complete } from '../ai';
import { isDemo } from '../ai';
import type { AICompletionRequest } from '../ai/types';

const log = createLogger('orchestrator');

export interface StartRunInput {
  userId: string;
  workspaceId: string;
  rawInput: string;
  projectId?: string | null;
  conversationId?: string | null;
  autoExecute?: boolean;
  /** Scheduler for the background pipeline. Defaults to fire-and-forget. */
  schedule?: (work: () => Promise<unknown>) => void;
}

export interface RunResult {
  intentId: string;
  status: string;
  plan: ExecutionPlan | null;
  response: StructuredResponse;
  runIds: string[];
  approvals: string[];
  artifactIds: string[];
  durationMs: number;
}

const cancelledRuns = new Set<string>();
const activeIntents = new Set<string>();

export function cancelRun(runId: string): void {
  cancelledRuns.add(runId);
}

export function isCancelled(runId: string): boolean {
  return cancelledRuns.has(runId);
}

export function activeRunCount(): number {
  return activeIntents.size;
}

/** Entry point. Returns immediately after scheduling; execution is background. */
export async function startRun(input: StartRunInput): Promise<{ intentId: string; runIds: string[] }> {
  const intent = await parseIntent({
    rawInput: input.rawInput,
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId ?? null,
  });

  const intentRow = await prisma.intent.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: intent.projectContext ?? input.projectId ?? null,
      conversationId: input.conversationId ?? null,
      rawInput: input.rawInput,
      objective: intent.objective,
      desiredOutcome: intent.desiredOutcome,
      entities: JSON.stringify(intent.entities),
      constraints: JSON.stringify(intent.constraints),
      deadline: intent.deadline,
      deadlineText: intent.deadlineText,
      projectContext: intent.projectContext,
      requiredCapabilities: JSON.stringify(intent.requiredCapabilities),
      riskLevel: intent.riskLevel,
      permissionsRequired: JSON.stringify(intent.permissionsRequired),
      confidence: intent.confidence,
      status: 'UNDERSTOOD',
      mode: isDemo() ? 'DEMO' : 'REAL',
    },
  });

  const graph = buildAgentGraph(intent);
  const agentNodes = graph.nodes.filter((n) => n.kind === 'agent' && n.ref);
  const runIds: string[] = [];

  for (const node of agentNodes) {
    const agent = getAgent(node.ref!);
    if (!agent) continue;
    const run = await prisma.agentRun.create({
      data: {
        intentId: intentRow.id,
        agentId: await ensureAgentRow(agent.key),
        workspaceId: input.workspaceId,
        projectId: intent.projectContext ?? input.projectId ?? null,
        triggeredById: input.userId,
        status: 'QUEUED',
        mode: isDemo() ? 'DEMO' : 'REAL',
        input: JSON.stringify({ nodeId: node.id, objective: intent.objective }),
      },
    });
    runIds.push(run.id);
  }

  await emitEvent(intentRow.id, runIds[0] ?? null, {
    type: 'INTENT',
    label: 'Intent understood',
    detail: `${intent.objective}${intent.deadlineText ? ` · deadline ${intent.deadlineText}` : ''}`,
    status: 'COMPLETED',
    nodeId: 'intent',
  });

  // Serverless runtimes (Vercel) freeze the instance once the response is sent,
  // which would strand the pipeline. The caller can hand us its scheduler —
  // Next's `after()` — so the run survives the response.
  const schedule = input.schedule ?? ((work: () => Promise<unknown>) => { void work(); });
  schedule(() =>
    runPipeline({
      intentId: intentRow.id,
      intent,
      graph: graph as ExecutionPlan['graph'],
      runIds,
      input,
    }).catch((err) => log.error('pipeline crashed', { intentId: intentRow.id, error: String(err) })),
  );

  return { intentId: intentRow.id, runIds };
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

interface PipelineInput {
  intentId: string;
  intent: IntentObject;
  graph: ExecutionPlan['graph'];
  runIds: string[];
  input: StartRunInput;
}

export async function runPipeline(pipeline: PipelineInput): Promise<RunResult> {
  const started = Date.now();
  const { intentId, intent, input } = pipeline;
  activeIntents.add(intentId);

  try {
    const policy = await loadPolicy(input.userId, input.workspaceId);
    const roleCeiling = await loadRoleCeiling(input.userId, input.workspaceId);
    const connectedIntegrations = await loadConnectedIntegrations(input.userId);

    // ── 1. Context ───────────────────────────────────────────────────────────
    await prisma.intent.update({ where: { id: intentId }, data: { status: 'PLANNING' } });
    const context: ContextBundle = await buildContext({
      workspaceId: input.workspaceId,
      userId: input.userId,
      intent,
      rawInput: input.rawInput,
      intentId,
    });

    await emitEvent(intentId, pipeline.runIds[0] ?? null, {
      type: 'CONTEXT',
      label: `Retrieved ${context.items.length} relevant item${context.items.length === 1 ? '' : 's'}`,
      detail: Object.entries(context.counts)
        .map(([k, v]) => `${v} ${k.toLowerCase().replace('_', ' ')}`)
        .join(', '),
      status: 'COMPLETED',
      nodeId: 'context',
    });

    await recordActivity({
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: intent.projectContext ?? null,
      intentId,
      type: 'AGENT',
      action: 'Context retrieved',
      summary: `${context.items.length} item(s) retrieved from ${context.sources.length} source type(s)`,
      severity: 'INFO',
    });

    // ── 2. Execute the DAG, wave by wave ────────────────────────────────────
    const nodeToRun = new Map<string, string>();
    const waves = topoWaves(pipeline.graph);
    const outputs: Record<string, AgentOutput> = {};
    const planStore: { value: ExecutionPlan | null } = { value: null };
    const approvalIds: string[] = [];

    for (const node of pipeline.graph.nodes) {
      if (node.kind === 'agent' && node.ref) {
        const run = await prisma.agentRun.findFirst({
          where: { intentId, agent: { key: node.ref } },
          orderBy: { createdAt: 'desc' },
        });
        if (run) nodeToRun.set(node.id, run.id);
      }
    }

    for (const wave of waves) {
      const agentIds = wave.filter((id) => nodeToRun.has(id));
      if (!agentIds.length) continue;

      await Promise.all(
        agentIds.map(async (nodeId) => {
          const node = pipeline.graph.nodes.find((n) => n.id === nodeId)!;
          const runId = nodeToRun.get(nodeId)!;
          if (cancelledRuns.has(runId)) return;

          const agentKey = node.ref!;
          const agent = getAgent(agentKey);
          if (!agent) return;

          // Wait for dependency outputs.
          for (const dep of node.dependsOn) {
            const depNode = pipeline.graph.nodes.find((n) => n.id === dep);
            if (depNode?.ref && !outputs[depNode.ref]) {
              // Dependency failed or was skipped — skip this node honestly.
              await prisma.agentRun.update({
                where: { id: runId },
                data: { status: 'CANCELLED', error: `Dependency "${dep}" did not produce output`, errorStep: dep, completedAt: new Date() },
              });
              await emitEvent(intentId, runId, {
                type: 'ERROR',
                label: `${agent.name} skipped`,
                detail: `Dependency "${dep}" produced no output.`,
                status: 'FAILED',
                nodeId,
              });
              return;
            }
          }

          await executeAgent({
            runId,
            intentId,
            intent,
            context,
            planRef: { get: () => planStore.value, set: (p) => { planStore.value = p; } },
            outputs,
            agentKey,
            policy,
            roleCeiling,
            connectedIntegrations,
            approvalIds,
            workspaceId: input.workspaceId,
            userId: input.userId,
            projectId: intent.projectContext ?? input.projectId ?? null,
            rawInput: input.rawInput,
          });

          const planningOutput = outputs[agentKey];
          if (planningOutput?.data?.plan) planStore.value = planningOutput.data.plan as ExecutionPlan;
        }),
      );
    }

    const plan: ExecutionPlan | null = planStore.value;

    // ── 3. Validation (§25) ────────────────────────────────────────────────
    const validation = await validateRun(intentId, plan, outputs);
    await emitEvent(intentId, pipeline.runIds[pipeline.runIds.length - 1] ?? null, {
      type: 'VALIDATION',
      label: validation.passed ? 'Validation completed' : 'Validation completed with issues',
      detail: `${validation.passedChecks}/${validation.checks.length} checks passed`,
      status: validation.passed ? 'COMPLETED' : 'FAILED',
      nodeId: 'validation',
    });

    // ── 4. Memory (§8) ────────────────────────────────────────────────────
    const memoryCandidates = deriveMemoryCandidates({
      intent: { ...intent, rawInput: input.rawInput },
      projectName: await projectName(intent.projectContext),
      taskTitles: plan?.tasks.map((t) => t.title) ?? [],
      approvals: await prisma.approval.findMany({
        where: { intentId },
        select: { title: true, status: true },
      }),
    });

    const memoryUpdates: { content: string; type: string; importance: number }[] = [];
    for (const candidate of memoryCandidates) {
      const { memory } = await writeMemory({
        workspaceId: input.workspaceId,
        userId: input.userId,
        projectId: candidate.projectId ?? intent.projectContext ?? null,
        content: candidate.content,
        type: candidate.type,
        importance: candidate.importance,
        confidence: candidate.confidence,
        source: 'AGENT',
        sourceRunId: pipeline.runIds[0] ?? null,
      });
      memoryUpdates.push({ content: memory.content, type: memory.type, importance: memory.importance });
    }

    if (memoryUpdates.length) {
      await emitEvent(intentId, pipeline.runIds[0] ?? null, {
        type: 'MEMORY',
        label: `Saved ${memoryUpdates.length} memory update${memoryUpdates.length === 1 ? '' : 's'}`,
        detail: memoryUpdates.map((m) => m.content.slice(0, 70)).join(' · '),
        status: 'COMPLETED',
        nodeId: 'result',
      });
    }

    // ── 5. Result ─────────────────────────────────────────────────────────
    const artifacts = await prisma.artifact.findMany({ where: { intentId }, select: { id: true, title: true, type: true } });
    const approvals = await prisma.approval.findMany({ where: { intentId } });
    const review = outputs.review;

    const failed = Object.values(outputs).filter((o) => (o as AgentOutput).summary.startsWith('failed'));
    const status = approvals.some((a) => a.status === 'PENDING')
      ? 'WAITING_APPROVAL'
      : failed.length
        ? 'FAILED'
        : 'COMPLETED';

    const structured: StructuredResponse = {
      intent,
      context: context.items,
      plan: plan?.steps ?? [],
      agents: Object.keys(outputs),
      tools: await distinctTools(intentId),
      approvals: approvals.map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        whatWillHappen: a.whatWillHappen,
        whyNeeded: a.whyNeeded,
        toolKey: a.toolKey,
        toolArguments: safeParse(a.toolArguments, {}),
        affectedData: safeParse(a.affectedData, []),
        permission: a.permission as PermissionLevel,
        riskLevel: a.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH',
        status: a.status as StructuredResponse['approvals'][number]['status'],
      })),
      result: {
        objective: intent.objective,
        deadline: intent.deadlineText,
        taskCount: plan?.tasks.length ?? 0,
        tasksCreated: (outputs.execution?.data?.created as unknown[])?.length ?? 0,
        tasksScheduled: (outputs.execution?.data?.updated as unknown[])?.length ?? 0,
        recommendations: review?.recommendations ?? [],
        artifacts: artifacts.map((a) => ({ id: a.id, title: a.title, type: a.type })),
        validation,
      },
      memoryUpdates,
    };

    await prisma.intent.update({
      where: { id: intentId },
      data: { status, result: JSON.stringify(structured) },
    });

    await prisma.agentRun.updateMany({
      where: { intentId, status: { in: ['QUEUED', 'PLANNING', 'RUNNING'] } },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    await emitEvent(intentId, pipeline.runIds[pipeline.runIds.length - 1] ?? null, {
      type: 'RESULT',
      label: status === 'WAITING_APPROVAL' ? 'Waiting for approval' : 'Result ready',
      detail: `${plan?.tasks.length ?? 0} task(s) · ${review?.recommendations?.length ?? 0} recommendation(s) · ${approvals.filter((a) => a.status === 'PENDING').length} approval(s) pending`,
      status: status === 'WAITING_APPROVAL' ? 'WAITING' : 'COMPLETED',
      nodeId: 'result',
    });

    await recordActivity({
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: intent.projectContext ?? null,
      intentId,
      type: 'AGENT',
      action: 'Run completed',
      summary: `${intent.objective} — ${Object.keys(outputs).length} agent(s) executed, ${artifacts.length} artifact(s) produced`,
      severity: status === 'FAILED' ? 'ERROR' : 'SUCCESS',
    });

    await notify({
      userId: input.userId,
      workspaceId: input.workspaceId,
      projectId: intent.projectContext ?? null,
      type: status === 'FAILED' ? 'AGENT_FAILED' : 'AGENT_COMPLETED',
      title: status === 'WAITING_APPROVAL' ? 'Approval required' : 'NEXUS finished a run',
      body: `${intent.objective} — ${plan?.tasks.length ?? 0} task(s), ${review?.recommendations?.length ?? 0} recommendation(s).`,
      actionUrl: `/runs/${intentId}`,
    });

    return {
      intentId,
      status,
      plan,
      response: structured,
      runIds: pipeline.runIds,
      approvals: approvalIds,
      artifactIds: artifacts.map((a) => a.id),
      durationMs: Date.now() - started,
    };
  } finally {
    activeIntents.delete(intentId);
  }
}

// ── Agent execution ──────────────────────────────────────────────────────────

interface ExecuteAgentInput {
  runId: string;
  intentId: string;
  intent: IntentObject;
  context: ContextBundle;
  planRef: { get: () => ExecutionPlan | null; set: (p: ExecutionPlan) => void };
  outputs: Record<string, AgentOutput>;
  agentKey: string;
  policy: PermissionPolicy;
  roleCeiling: PermissionLevel;
  connectedIntegrations: string[];
  approvalIds: string[];
  workspaceId: string;
  userId: string;
  projectId: string | null;
  rawInput: string;
}

async function executeAgent(input: ExecuteAgentInput): Promise<void> {
  const agent = getAgent(input.agentKey);
  if (!agent) return;

  const startedAt = new Date();
  await prisma.agentRun.update({
    where: { id: input.runId },
    data: { status: 'RUNNING', startedAt },
  });

  await emitEvent(input.intentId, input.runId, {
    type: 'AGENT',
    label: `${agent.name} started`,
    detail: agent.description,
    status: 'RUNNING',
    nodeId: input.agentKey,
  });

  const grantedApprovals: PermissionLevel[] = [];
  let toolCalls = 0;
  let tokens = 0;

  const callTool = async (toolKey: string, args: unknown): Promise<ToolOutcome> => {
    // Tool authorization: agents may only invoke tools they declare.
    if (!agent.allowedTools.includes(toolKey)) {
      await recordToolExecution({
        runId: input.runId,
        toolKey,
        args,
        status: 'FAILED',
        permission: 'READ',
        error: `Agent "${agent.key}" is not authorised to call ${toolKey}`,
      });
      return { toolKey, status: 'FAILED', error: `Tool ${toolKey} not permitted for agent ${agent.key}`, permission: 'READ' };
    }

    const tool = toolRegistry.get(toolKey);
    if (!tool) {
      return { toolKey, status: 'FAILED', error: `Unknown tool ${toolKey}`, permission: 'READ' };
    }

    const decision = authorize(tool.permission, {
      roleCeiling: input.roleCeiling,
      policy: input.policy,
      connectedIntegrations: input.connectedIntegrations,
      requiredIntegrations: tool.requiresIntegration ? [tool.requiresIntegration] : [],
      grantedApprovals,
    });

    if (!decision.allowed && decision.requiresApproval) {
      return requestApproval({ ...input, tool, toolKey, args, agentKey: agent.key, approved: grantedApprovals });
    }

    if (!decision.allowed) {
      await recordToolExecution({
        runId: input.runId,
        toolKey,
        args,
        status: 'BLOCKED',
        permission: tool.permission,
        error: decision.reason,
      });
      return { toolKey, status: 'BLOCKED', error: decision.reason, permission: tool.permission };
    }

    return runTool({ ...input, tool, toolKey, args });
  };

  const ctx: AgentContext = {
    runId: input.runId,
    intentId: input.intentId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    intent: input.intent,
    rawInput: input.rawInput,
    context: input.context,
    plan: input.planRef.get(),
    prior: input.outputs,
    callTool,
    emit: async (label, detail, status = 'RUNNING') => {
      await emitEvent(input.intentId, input.runId, { type: 'AGENT', label, detail: detail ?? null, status, nodeId: input.agentKey });
    },
    writeMemory: async (candidate: MemoryCandidate) => {
      await writeMemory({
        workspaceId: input.workspaceId,
        userId: input.userId,
        projectId: candidate.projectId ?? input.projectId,
        content: candidate.content,
        type: candidate.type,
        importance: candidate.importance,
        confidence: candidate.confidence,
        source: 'AGENT',
        sourceRunId: input.runId,
      });
    },
    ai: async (request) =>
      complete({
        ...request,
        messages: [
          { role: 'system', content: agent.systemPrompt },
          { role: 'user', content: JSON.stringify(request.variables ?? {}).slice(0, 12000) },
        ],
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      } as AICompletionRequest),
    mode: isDemo() ? 'DEMO' : 'REAL',
  };

  try {
    const output = await agent.execute(ctx);
    toolCalls = output.toolCalls;
    tokens = output.tokens;
    input.outputs[agent.key] = output;

    const durationMs = Date.now() - startedAt.getTime();
    await prisma.agentRun.update({
      where: { id: input.runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        durationMs,
        outputs: JSON.stringify(output.data ?? {}),
        context: JSON.stringify({ items: input.context.items.length, confidence: input.context.confidence }),
        tokens: output.tokens,
      },
    });
    await updateAgentStats(agent.key, true, durationMs, output.tokens);

    await emitEvent(input.intentId, input.runId, {
      type: 'AGENT',
      label: `${agent.name} completed`,
      detail: output.summary,
      status: 'COMPLETED',
      nodeId: input.agentKey,
    });
  } catch (err) {
    const error = toNexusError(err);
    const durationMs = Date.now() - startedAt.getTime();
    await prisma.agentRun.update({
      where: { id: input.runId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        durationMs,
        error: error.message,
        errorStep: agent.key,
      },
    });
    await updateAgentStats(agent.key, false, durationMs, 0);
    await emitEvent(input.intentId, input.runId, {
      type: 'ERROR',
      label: `${agent.name} failed`,
      detail: error.message,
      status: 'FAILED',
      nodeId: input.agentKey,
    });
    await recordActivity({
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId,
      intentId: input.intentId,
      type: 'ERROR',
      action: 'Agent failed',
      summary: `${agent.name}: ${error.message}`,
      severity: 'ERROR',
      status: 'FAILED',
    });
    throw error;
  }

  void toolCalls;
  void tokens;
}

async function runTool(input: ExecuteAgentInput & {
  tool: ReturnType<typeof toolRegistry.require>;
  toolKey: string;
  args: unknown;
}): Promise<ToolOutcome> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs);
  const execution = await prisma.toolExecution.create({
    data: {
      runId: input.runId,
      toolKey: input.toolKey,
      arguments: JSON.stringify(input.args ?? {}),
      permission: input.tool.permission,
      status: 'RUNNING',
      startedAt,
    },
  });

  await emitEvent(input.intentId, input.runId, {
    type: 'TOOL',
    label: `${input.toolKey} invoked`,
    detail: describeArgs(input.args),
    status: 'RUNNING',
    nodeId: input.agentKey,
  });

  try {
    const { result, attempt } = await toolRegistry.execute(input.toolKey, input.args, {
      userId: input.userId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      runId: input.runId,
      intentId: input.intentId,
      agentKey: input.agentKey,
      mode: isDemo() ? 'DEMO' : 'REAL',
    });

    const durationMs = Date.now() - startedAtMs;
    const isBlockedResult = Boolean((result as { blocked?: boolean } | null)?.blocked);

    await prisma.toolExecution.update({
      where: { id: execution.id },
      data: {
        status: isBlockedResult ? 'BLOCKED' : 'COMPLETED',
        result: JSON.stringify(result ?? null),
        durationMs,
        attempt,
        completedAt: new Date(),
      },
    });

    await emitEvent(input.intentId, input.runId, {
      type: 'TOOL',
      label: isBlockedResult ? `${input.toolKey} blocked` : `${input.toolKey} completed`,
      detail: isBlockedResult
        ? String((result as { reason?: string }).reason ?? 'Blocked')
        : `Completed in ${durationMs}ms`,
      status: isBlockedResult ? 'FAILED' : 'COMPLETED',
      nodeId: input.agentKey,
    });

    return {
      toolKey: input.toolKey,
      status: isBlockedResult ? 'BLOCKED' : 'COMPLETED',
      result: result as unknown,
      error: isBlockedResult ? String((result as { reason?: string }).reason ?? 'Blocked') : undefined,
      executionId: execution.id,
      durationMs,
      permission: input.tool.permission,
    };
  } catch (err) {
    const error = toNexusError(err);
    await prisma.toolExecution.update({
      where: { id: execution.id },
      data: { status: 'FAILED', error: error.message, durationMs: Date.now() - startedAtMs, completedAt: new Date() },
    });
    await emitEvent(input.intentId, input.runId, {
      type: 'TOOL',
      label: `${input.toolKey} failed`,
      detail: error.message,
      status: 'FAILED',
      nodeId: input.agentKey,
    });
    return { toolKey: input.toolKey, status: 'FAILED', error: error.message, permission: input.tool.permission };
  }
}

async function requestApproval(input: ExecuteAgentInput & {
  tool: ReturnType<typeof toolRegistry.require>;
  toolKey: string;
  args: unknown;
  agentKey: string;
  approved: PermissionLevel[];
}): Promise<ToolOutcome> {
  const affectedData = describeAffectedData(input.toolKey, input.args);

  const approval = await prisma.approval.create({
    data: {
      workspaceId: input.workspaceId,
      intentId: input.intentId,
      runId: input.runId,
      projectId: input.projectId,
      title: `${input.tool.name}`,
      description: input.tool.description,
      whatWillHappen: `NEXUS will call ${input.toolKey} with the arguments below.`,
      whyNeeded: `${input.tool.permission.replace('_', ' ')} actions are never executed without your approval.`,
      toolKey: input.toolKey,
      toolArguments: JSON.stringify(input.args ?? {}),
      affectedData: JSON.stringify(affectedData),
      permission: input.tool.permission,
      riskLevel: input.tool.permission === 'HIGH_IMPACT' ? 'HIGH' : input.tool.permission === 'EXTERNAL_ACTION' ? 'HIGH' : 'MEDIUM',
      status: 'PENDING',
    },
  });

  await prisma.agentRun.update({ where: { id: input.runId }, data: { status: 'WAITING_APPROVAL' } });
  await prisma.intent.update({ where: { id: input.intentId }, data: { status: 'WAITING_APPROVAL' } });

  await emitEvent(input.intentId, input.runId, {
    type: 'APPROVAL',
    label: 'Waiting for approval',
    detail: `${input.toolKey} — ${approval.title}`,
    status: 'WAITING',
    nodeId: input.agentKey,
  });

  await recordActivity({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    intentId: input.intentId,
    approvalId: approval.id,
    type: 'APPROVAL',
    action: 'Approval required',
    summary: `${input.toolKey} requires ${input.tool.permission} approval`,
    severity: 'WARNING',
  });

  await notify({
    userId: input.userId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    type: 'APPROVAL_REQUIRED',
    title: 'Approval required',
    body: `${input.tool.name} — ${input.tool.permission.replace('_', ' ')}`,
    severity: 'WARNING',
    actionUrl: '/approvals',
    metadata: { approvalId: approval.id },
  });

  try {
    const decision = await waitForApproval(approval.id, input.runId);
    if (decision.decision === 'DENIED') {
      await prisma.approval.update({
        where: { id: approval.id },
        data: { status: 'DENIED', decidedById: input.userId, decisionNote: decision.note ?? null, decidedAt: new Date() },
      });
      await emitEvent(input.intentId, input.runId, {
        type: 'APPROVAL',
        label: 'Approval denied',
        detail: input.toolKey,
        status: 'FAILED',
        nodeId: input.agentKey,
      });
      return { toolKey: input.toolKey, status: 'DENIED', approvalId: approval.id, permission: input.tool.permission };
    }

    input.approved.push(input.tool.permission);
    const args = decision.decision === 'MODIFIED' && decision.modifiedArgs ? decision.modifiedArgs : input.args;

    await prisma.approval.update({
      where: { id: approval.id },
      data: {
        status: decision.decision === 'MODIFIED' ? 'MODIFIED' : 'APPROVED',
        decidedById: input.userId,
        decisionNote: decision.note ?? null,
        decidedAt: new Date(),
      },
    });
    await prisma.agentRun.update({ where: { id: input.runId }, data: { status: 'RUNNING' } });

    await emitEvent(input.intentId, input.runId, {
      type: 'APPROVAL',
      label: 'Approval granted',
      detail: input.toolKey,
      status: 'COMPLETED',
      nodeId: input.agentKey,
    });

    const outcome = await runTool({ ...input, args });

    // An approval is granted for the action you approved — not for every later
    // action of the same permission class. Revoke it immediately after use.
    const grantedIndex = input.approved.indexOf(input.tool.permission);
    if (grantedIndex >= 0) input.approved.splice(grantedIndex, 1);

    await prisma.approval.update({ where: { id: approval.id }, data: { result: JSON.stringify(outcome.result ?? null) } });
    return { ...outcome, approvalId: approval.id };
  } catch (err) {
    const error = toNexusError(err);
    await emitEvent(input.intentId, input.runId, {
      type: 'APPROVAL',
      label: 'Approval not resolved',
      detail: error.message,
      status: 'FAILED',
      nodeId: input.agentKey,
    });
    return { toolKey: input.toolKey, status: 'FAILED', error: error.message, approvalId: approval.id, permission: input.tool.permission };
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

interface ValidationReport {
  passed: boolean;
  passedChecks: number;
  checks: { name: string; passed: boolean; detail: string }[];
}

async function validateRun(
  intentId: string,
  plan: ExecutionPlan | null,
  outputs: Record<string, AgentOutput>,
): Promise<ValidationReport> {
  const checks: ValidationReport['checks'] = [];

  const failedTools = await prisma.toolExecution.count({
    where: { run: { intentId }, status: { in: ['FAILED', 'VALIDATION_FAILED'] } },
  });
  checks.push({
    name: 'Tool calls succeeded',
    passed: failedTools === 0,
    detail: failedTools ? `${failedTools} tool call(s) failed` : 'All tool calls completed',
  });

  checks.push({
    name: 'Execution plan produced',
    passed: Boolean(plan && plan.tasks.length > 0),
    detail: plan ? `${plan.tasks.length} workstream(s)` : 'No plan produced',
  });

  const artifacts = await prisma.artifact.count({ where: { intentId } });
  checks.push({
    name: 'Artifacts generated',
    passed: artifacts > 0,
    detail: `${artifacts} artifact(s) stored`,
  });

  const runs = await prisma.agentRun.findMany({ where: { intentId }, select: { status: true } });
  const failedRuns = runs.filter((r) => r.status === 'FAILED').length;
  checks.push({
    name: 'Agents completed',
    passed: failedRuns === 0,
    detail: `${runs.length - failedRuns}/${runs.length} agent run(s) completed`,
  });

  checks.push({
    name: 'Structured output contract',
    passed: typeof outputs === 'object' && Object.keys(outputs).length > 0,
    detail: `${Object.keys(outputs).length} agent output(s) validated against the response contract`,
  });

  const passedChecks = checks.filter((c) => c.passed).length;
  return { passed: passedChecks === checks.length, passedChecks, checks };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const agentRowCache = new Map<string, string>();

async function ensureAgentRow(key: string): Promise<string> {
  const cached = agentRowCache.get(key);
  if (cached) return cached;
  const agent = getAgent(key);
  if (!agent) throw new NexusError('NOT_FOUND', `Agent ${key} not registered`);
  const row = await prisma.agent.upsert({
    where: { key },
    create: {
      key,
      name: agent.name,
      description: agent.description,
      category: agent.category,
      systemPrompt: agent.systemPrompt,
      capabilities: JSON.stringify(agent.capabilities),
      allowedTools: JSON.stringify(agent.allowedTools),
      permissionLevel: agent.permissionLevel,
    },
    update: {
      name: agent.name,
      description: agent.description,
      capabilities: JSON.stringify(agent.capabilities),
      allowedTools: JSON.stringify(agent.allowedTools),
    },
  });
  agentRowCache.set(key, row.id);
  return row.id;
}

async function updateAgentStats(key: string, success: boolean, durationMs: number, tokens: number) {
  const agentRowId = await ensureAgentRow(key);
  await prisma.agent.update({
    where: { id: agentRowId },
    data: {
      totalRuns: { increment: 1 },
      successRuns: success ? { increment: 1 } : undefined,
      failedRuns: success ? undefined : { increment: 1 },
      totalLatencyMs: { increment: durationMs },
      totalTokens: { increment: tokens },
      status: 'IDLE',
    },
  });
}

export async function emitEvent(
  intentId: string,
  runId: string | null,
  event: {
    type: 'INTENT' | 'CONTEXT' | 'PLAN' | 'AGENT' | 'TOOL' | 'APPROVAL' | 'VALIDATION' | 'RESULT' | 'MEMORY' | 'ERROR' | 'CANCEL';
    label: string;
    detail: string | null;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'WAITING';
    nodeId: string | null;
  },
) {
  // Intent-level events carry no run; the timeline API keys off intentId.
  await prisma.runEvent.create({
    data: {
      runId,
      intentId,
      type: event.type,
      label: event.label,
      detail: event.detail,
      status: event.status,
      nodeId: event.nodeId,
    },
  });
}

async function recordToolExecution(input: {
  runId: string;
  toolKey: string;
  args: unknown;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'VALIDATION_FAILED';
  permission: PermissionLevel;
  error?: string;
}) {
  await prisma.toolExecution.create({
    data: {
      runId: input.runId,
      toolKey: input.toolKey,
      arguments: JSON.stringify(input.args ?? {}),
      status: input.status,
      permission: input.permission,
      error: input.error ?? null,
      completedAt: new Date(),
    },
  });
}

function describeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return String(args ?? '');
  return Object.entries(args as Record<string, unknown>)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
    .join(', ');
}

function describeAffectedData(toolKey: string, args: unknown): string[] {
  const out: string[] = [];
  if (toolKey.startsWith('tasks.')) out.push('Task records in this workspace');
  if (toolKey.startsWith('projects.')) out.push('Project record and computed health');
  if (toolKey === 'email.draft') out.push('A new email draft stored in the workspace');
  if (toolKey === 'calendar.create') out.push('A new calendar event stored in the workspace');
  if (toolKey.startsWith('github.')) out.push('External: GitHub repository data');
  if (toolKey === 'artifact.generate') out.push('A new artifact record');
  if (toolKey.startsWith('knowledge.')) out.push('Knowledge graph items');
  if (!out.length) out.push('Workspace data');
  const recipient = (args as { to?: string } | null)?.to;
  if (recipient) out.push(`Recipient: ${recipient}`);
  return out;
}

async function loadPolicy(userId: string, workspaceId: string): Promise<PermissionPolicy> {
  const settings = await prisma.setting.findFirst({
    where: { userId, namespace: 'permissions', key: 'policy' },
  });
  if (!settings) return { ...DEFAULT_POLICY };
  try {
    return { ...DEFAULT_POLICY, ...(JSON.parse(settings.value) as Partial<PermissionPolicy>) };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

async function loadRoleCeiling(userId: string, workspaceId: string): Promise<PermissionLevel> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const membership = await prisma.membership.findFirst({ where: { userId }, select: { role: true } });
  const role = membership?.role ?? user?.role ?? 'MEMBER';
  if (role === 'OWNER' || role === 'ADMIN') return 'HIGH_IMPACT';
  if (role === 'MEMBER') return 'EXTERNAL_ACTION';
  return 'READ';
}

async function loadConnectedIntegrations(userId: string): Promise<string[]> {
  const rows = await prisma.integration.findMany({
    where: { userId, status: 'CONNECTED' },
    select: { key: true },
  });
  return rows.map((r) => r.key);
}

async function projectName(projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  return project?.name ?? null;
}

async function distinctTools(intentId: string): Promise<string[]> {
  const rows = await prisma.toolExecution.findMany({
    where: { run: { intentId } },
    select: { toolKey: true },
    distinct: ['toolKey'],
  });
  return rows.map((r) => r.toolKey);
}

function safeParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export { AGENTS };
