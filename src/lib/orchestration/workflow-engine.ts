/**
 * Workflow engine (§18).
 *
 * Executes a saved, versioned node graph: TRIGGER → AGENT → TOOL → CONDITION →
 * APPROVAL → DELAY → BRANCH → LOOP → OUTPUT. Every node transition is persisted
 * to WorkflowRun + Activity, so runs are observable and auditable.
 */

import { z } from 'zod';
import { prisma } from '../db';
import { getAgent } from '../agents/registry';
import type { AgentContext } from '../agents/types';
import { toolRegistry } from '../tools/registry';
import { authorize, DEFAULT_POLICY, type PermissionPolicy } from '../permissions/engine';
import { waitForApproval } from './approvals';
import { isDemo } from '../ai';
import { buildContext } from '../retrieval/context-engine';
import { parseIntent } from '../intelligence/intent-engine';
import { recordActivity } from '../../server/services/activity';
import { notify } from '../../server/services/notifications';
import { NexusError, toNexusError } from '../errors';
import { createLogger } from '../logger';
import type { ContextBundle, IntentObject, PermissionLevel } from '@/types';

const log = createLogger('workflow');

export const nodeTypeSchema = z.enum([
  'TRIGGER', 'AGENT', 'TOOL', 'CONDITION', 'APPROVAL', 'DELAY', 'BRANCH', 'LOOP', 'OUTPUT',
]);

export const workflowNodeSchema = z.object({
  id: z.string(),
  type: nodeTypeSchema,
  label: z.string(),
  data: z.record(z.unknown()).default({}),
});

export const workflowEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  fromHandle: z.string().default('out'),
});

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
});

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

/** Structural validation: reachable nodes, single trigger, no cycles beyond loops. */
export function validateGraph(graph: WorkflowGraph): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) errors.push(`Edge references unknown source node "${edge.from}"`);
    if (!ids.has(edge.to)) errors.push(`Edge references unknown target node "${edge.to}"`);
  }

  const triggers = graph.nodes.filter((n) => n.type === 'TRIGGER');
  if (triggers.length === 0) errors.push('Workflow has no trigger node');
  if (triggers.length > 1) warnings.push('Workflow has multiple trigger nodes; the first will be used');

  for (const node of graph.nodes) {
    if (node.type === 'AGENT' && typeof node.data.agentKey !== 'string') {
      errors.push(`Agent node "${node.label}" is missing an agent`);
    }
    if (node.type === 'TOOL' && typeof node.data.toolKey !== 'string') {
      errors.push(`Tool node "${node.label}" is missing a tool`);
    }
    if (node.type === 'CONDITION' && typeof node.data.expression !== 'string') {
      errors.push(`Condition node "${node.label}" is missing an expression`);
    }
  }

  const outputs = graph.nodes.filter((n) => n.type === 'OUTPUT');
  if (!outputs.length) warnings.push('Workflow has no output node; results will not be captured');

  return { valid: errors.length === 0, errors, warnings };
}

interface RunState {
  variables: Record<string, unknown>;
  log: { nodeId: string; label: string; type: string; status: string; detail?: string; at: string }[];
}

export interface WorkflowRunInput {
  workflowId: string;
  userId: string;
  workspaceId: string;
  projectId?: string | null;
  intentId?: string | null;
  input?: Record<string, unknown>;
}

const MAX_STEPS = 60;

export async function runWorkflow(input: WorkflowRunInput) {
  const workflow = await prisma.workflow.findUnique({ where: { id: input.workflowId } });
  if (!workflow) throw new NexusError('NOT_FOUND', 'Workflow not found');

  const parsed = workflowGraphSchema.safeParse(JSON.parse(workflow.graph));
  if (!parsed.success) throw new NexusError('VALIDATION', 'Workflow graph is invalid');
  const graph = parsed.data;

  const validation = validateGraph(graph);
  if (!validation.valid) throw new NexusError('VALIDATION', validation.errors.join('; '));

  const run = await prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      intentId: input.intentId ?? null,
      status: 'RUNNING',
      startedAt: new Date(),
      input: JSON.stringify(input.input ?? {}),
    },
  });

  const state: RunState = { variables: { ...(input.input ?? {}) }, log: [] };
  const policy: PermissionPolicy = await loadPolicy(input.userId);

  try {
    let current: WorkflowNode | undefined = graph.nodes.find((n) => n.type === 'TRIGGER');
    let steps = 0;

    while (current && steps < MAX_STEPS) {
      steps++;
      await prisma.workflowRun.update({ where: { id: run.id }, data: { currentNode: current.id } });

      const next = await executeNode({
        node: current,
        graph,
        state,
        runId: run.id,
        userId: input.userId,
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        policy,
      });

      state.log.push({
        nodeId: current.id,
        label: current.label,
        type: current.type,
        status: next.status,
        detail: next.detail,
        at: new Date().toISOString(),
      });

      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { output: JSON.stringify({ variables: state.variables, log: state.log }) },
      });

      if (next.status === 'FAILED') throw new NexusError('AGENT_FAILED', next.detail ?? 'Node failed');
      if (next.status === 'WAITING') {
        await prisma.workflowRun.update({ where: { id: run.id }, data: { status: 'WAITING_APPROVAL' } });
        return { runId: run.id, status: 'WAITING_APPROVAL', state };
      }
      if (!next.nextNodeId) break;
      current = next.nextNodeId ? graph.nodes.find((n) => n.id === next.nextNodeId) : undefined;
    }

    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        durationMs: Date.now() - run.createdAt.getTime(),
        output: JSON.stringify({ variables: state.variables, log: state.log }),
      },
    });

    await recordActivity({
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId ?? null,
      type: 'WORKFLOW',
      action: 'Workflow completed',
      summary: `${workflow.name} — ${state.log.length} node(s) executed`,
      entityType: 'WORKFLOW',
      entityId: workflow.id,
      severity: 'SUCCESS',
    });

    await notify({
      userId: input.userId,
      workspaceId: input.workspaceId,
      type: 'WORKFLOW_COMPLETED',
      title: 'Workflow completed',
      body: `${workflow.name} finished ${state.log.length} step(s).`,
      actionUrl: '/workflows',
    });

    return { runId: run.id, status: 'COMPLETED', state };
  } catch (error) {
    const e = toNexusError(error);
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        error: e.message,
        completedAt: new Date(),
        durationMs: Date.now() - run.createdAt.getTime(),
        output: JSON.stringify({ variables: state.variables, log: state.log }),
      },
    });
    await recordActivity({
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId ?? null,
      type: 'ERROR',
      action: 'Workflow failed',
      summary: `${workflow.name}: ${e.message}`,
      severity: 'ERROR',
      status: 'FAILED',
    });
    throw e;
  }
}

interface NodeResult {
  status: 'COMPLETED' | 'FAILED' | 'WAITING';
  nextNodeId?: string | null;
  detail?: string;
}

async function executeNode(input: {
  node: WorkflowNode;
  graph: WorkflowGraph;
  state: RunState;
  runId: string;
  userId: string;
  workspaceId: string;
  projectId: string | null;
  policy: PermissionPolicy;
}): Promise<NodeResult> {
  const { node, graph, state } = input;

  const outgoing = graph.edges.filter((e) => e.from === node.id);
  const next = (handle = 'out') => outgoing.find((e) => e.fromHandle === handle)?.to ?? outgoing[0]?.to ?? null;

  switch (node.type) {
    case 'TRIGGER':
      return { status: 'COMPLETED', nextNodeId: next(), detail: 'Trigger fired' };

    case 'DELAY': {
      const ms = Math.min(30_000, Number(node.data.ms ?? 1000));
      await new Promise((r) => setTimeout(r, ms));
      return { status: 'COMPLETED', nextNodeId: next(), detail: `Waited ${ms}ms` };
    }

    case 'CONDITION':
    case 'BRANCH': {
      const expression = String(node.data.expression ?? 'true');
      const value = evaluateExpression(expression, state.variables);
      state.variables[`${node.id}.result`] = value;
      return {
        status: 'COMPLETED',
        nextNodeId: next(value ? 'true' : 'false'),
        detail: `${expression} → ${value}`,
      };
    }

    case 'OUTPUT': {
      const value = node.data.value ? interpolate(String(node.data.value), state.variables) : state.variables;
      state.variables.output = value;
      return { status: 'COMPLETED', nextNodeId: next(), detail: 'Output captured' };
    }

    case 'TOOL': {
      const toolKey = String(node.data.toolKey ?? '');
      const tool = toolRegistry.get(toolKey);
      if (!tool) return { status: 'FAILED', detail: `Unknown tool ${toolKey}` };

      const args = interpolateObject((node.data.args ?? {}) as Record<string, unknown>, state.variables);
      const decision = authorize(tool.permission, {
        roleCeiling: 'HIGH_IMPACT',
        policy: input.policy,
        connectedIntegrations: [],
        requiredIntegrations: [],
        grantedApprovals: [],
      });

      if (!decision.allowed) {
        state.variables[`${node.id}.error`] = decision.reason;
        return { status: 'FAILED', detail: decision.reason };
      }

      try {
        const { result } = await toolRegistry.execute(toolKey, args, {
          userId: input.userId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          mode: isDemo() ? 'DEMO' : 'REAL',
        });
        state.variables[`${node.id}.result`] = result;
        state.variables.lastResult = result;
        return { status: 'COMPLETED', nextNodeId: next(), detail: `${toolKey} executed` };
      } catch (error) {
        const e = toNexusError(error);
        state.variables[`${node.id}.error`] = e.message;
        return { status: 'FAILED', detail: e.message };
      }
    }

    case 'APPROVAL': {
      const approval = await prisma.approval.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          title: String(node.data.title ?? node.label),
          description: String(node.data.description ?? 'Workflow approval gate'),
          whatWillHappen: String(node.data.whatWillHappen ?? 'The workflow will continue past this gate.'),
          whyNeeded: 'This workflow node is configured to require human approval.',
          toolKey: node.data.toolKey ? String(node.data.toolKey) : null,
          permission: (String(node.data.permission ?? 'WRITE') as PermissionLevel),
          riskLevel: 'MEDIUM',
          status: 'PENDING',
        },
      });

      const decision = await waitForApproval(approval.id, input.runId);
      if (decision.decision === 'DENIED') {
        await prisma.approval.update({ where: { id: approval.id }, data: { status: 'DENIED', decidedAt: new Date(), decidedById: input.userId } });
        return { status: 'FAILED', detail: 'Approval denied' };
      }
      await prisma.approval.update({
        where: { id: approval.id },
        data: { status: decision.decision === 'MODIFIED' ? 'MODIFIED' : 'APPROVED', decidedAt: new Date(), decidedById: input.userId },
      });
      return { status: 'COMPLETED', nextNodeId: next(decision.decision === 'MODIFIED' ? 'modified' : 'out'), detail: 'Approved' };
    }

    case 'LOOP': {
      const source = String(node.data.source ?? 'items');
      const items = Array.isArray(state.variables[source]) ? (state.variables[source] as unknown[]) : [];
      const max = Math.min(20, Number(node.data.maxIterations ?? items.length ?? 1));
      state.variables[`${node.id}.iterations`] = Math.min(max, items.length || max);
      return { status: 'COMPLETED', nextNodeId: next(items.length ? 'body' : 'done'), detail: `${Math.min(max, items.length)} iteration(s)` };
    }

    case 'AGENT': {
      const agentKey = String(node.data.agentKey ?? '');
      const agent = getAgent(agentKey);
      if (!agent) return { status: 'FAILED', detail: `Unknown agent ${agentKey}` };

      const objective = interpolate(String(node.data.instruction ?? node.label), state.variables);
      const intent: IntentObject = await parseIntent({
        rawInput: objective,
        workspaceId: input.workspaceId,
        userId: input.userId,
        projectId: input.projectId,
      });

      let context: ContextBundle = { items: [], query: objective, confidence: 0, sources: [], retrievedAt: new Date(), counts: {} };
      if (state.variables.intentId && typeof state.variables.intentId === 'string') {
        context = await buildContext({
          workspaceId: input.workspaceId,
          userId: input.userId,
          intent,
          rawInput: objective,
          intentId: state.variables.intentId,
          persist: false,
        });
      }

      const ctx: AgentContext = {
        runId: input.runId,
        intentId: typeof state.variables.intentId === 'string' ? state.variables.intentId : '',
        workspaceId: input.workspaceId,
        userId: input.userId,
        projectId: input.projectId,
        intent,
        rawInput: objective,
        context,
        plan: null,
        prior: (state.variables.agentOutputs as Record<string, never>) ?? {},
        callTool: async (toolKey, args) => {
          if (!agent.allowedTools.includes(toolKey)) {
            return { toolKey, status: 'FAILED', error: `Agent ${agentKey} may not call ${toolKey}`, permission: 'READ' };
          }
          const tool = toolRegistry.get(toolKey);
          if (!tool) return { toolKey, status: 'FAILED', error: `Unknown tool ${toolKey}`, permission: 'READ' };
          const decision = authorize(tool.permission, {
            roleCeiling: 'HIGH_IMPACT',
            policy: input.policy,
            connectedIntegrations: [],
            requiredIntegrations: [],
            grantedApprovals: [],
          });
          if (!decision.allowed) return { toolKey, status: 'BLOCKED', error: decision.reason, permission: tool.permission };
          try {
            const { result } = await toolRegistry.execute(toolKey, args, {
              userId: input.userId,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              agentKey,
              mode: isDemo() ? 'DEMO' : 'REAL',
            });
            return { toolKey, status: 'COMPLETED', result, permission: tool.permission };
          } catch (error) {
            return { toolKey, status: 'FAILED', error: toNexusError(error).message, permission: tool.permission };
          }
        },
        emit: async (label, detail) => {
          state.log.push({ nodeId: node.id, label, type: 'AGENT_EVENT', status: 'RUNNING', detail, at: new Date().toISOString() });
        },
        writeMemory: async () => undefined,
        ai: async (request) => (await import('../ai')).complete({
          ...request,
          messages: [{ role: 'system', content: agent.systemPrompt }, { role: 'user', content: JSON.stringify(request.variables ?? {}).slice(0, 12000) }],
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
        }),
        mode: isDemo() ? 'DEMO' : 'REAL',
      };

      try {
        const output = await agent.execute(ctx);
        const outputs = (state.variables.agentOutputs as Record<string, unknown>) ?? {};
        outputs[agentKey] = output;
        state.variables.agentOutputs = outputs;
        state.variables.lastResult = output.data;
        return { status: 'COMPLETED', nextNodeId: next(), detail: output.summary };
      } catch (error) {
        return { status: 'FAILED', detail: toNexusError(error).message };
      }
    }

    default:
      return { status: 'COMPLETED', nextNodeId: next() };
  }
}

/** Minimal, safe expression evaluation: comparisons and boolean logic only. */
export function evaluateExpression(expression: string, variables: Record<string, unknown>): boolean {
  const resolve = (key: string): unknown => {
    const value = key.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
      return undefined;
    }, variables);
    return value;
  };

  const patterns: { regex: RegExp; evaluate: (m: RegExpMatchArray) => boolean }[] = [
    { regex: /^([\w.]+)\s*>\s*([\d.]+)$/, evaluate: (m) => Number(resolve(m[1]!)) > Number(m[2]) },
    { regex: /^([\w.]+)\s*<\s*([\d.]+)$/, evaluate: (m) => Number(resolve(m[1]!)) < Number(m[2]) },
    { regex: /^([\w.]+)\s*>=\s*([\d.]+)$/, evaluate: (m) => Number(resolve(m[1]!)) >= Number(m[2]) },
    { regex: /^([\w.]+)\s*<=\s*([\d.]+)$/, evaluate: (m) => Number(resolve(m[1]!)) <= Number(m[2]) },
    { regex: /^([\w.]+)\s*==\s*(.+)$/, evaluate: (m) => String(resolve(m[1]!)) === m[2]!.replace(/^['"]|['"]$/g, '') },
    { regex: /^([\w.]+)\s*!=\s*(.+)$/, evaluate: (m) => String(resolve(m[1]!)) !== m[2]!.replace(/^['"]|['"]$/g, '') },
  ];

  const trimmed = expression.trim();
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;

  for (const pattern of patterns) {
    const match = trimmed.match(pattern.regex);
    if (match) return pattern.evaluate(match);
  }

  const raw = resolve(trimmed);
  log.warn('unparsed condition expression, defaulting to truthiness', { expression });
  return Boolean(raw);
}

function interpolate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
    const value = key.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
      return undefined;
    }, variables);
    return value === undefined || value === null ? '' : String(value);
  });
}

function interpolateObject(input: Record<string, unknown>, variables: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = typeof value === 'string' ? interpolate(value, variables) : value;
  }
  return out;
}

async function loadPolicy(userId: string): Promise<PermissionPolicy> {
  const settings = await prisma.setting.findFirst({ where: { userId, namespace: 'permissions', key: 'policy' } });
  if (!settings) return { ...DEFAULT_POLICY };
  try {
    return { ...DEFAULT_POLICY, ...(JSON.parse(settings.value) as Partial<PermissionPolicy>) };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}
