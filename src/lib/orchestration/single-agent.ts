/**
 * Execute a single agent outside a full pipeline.
 * Same tool allowlist, permission checks and approval gating as the orchestrator.
 */

import { prisma } from '../db';
import { getAgent } from '../agents/registry';
import type { AgentContext, AgentOutput, ToolOutcome } from '../agents/types';
import { toolRegistry } from '../tools/registry';
import { authorize, DEFAULT_POLICY, type PermissionPolicy } from '../permissions/engine';
import { waitForApproval } from './approvals';
import { buildContext } from '../retrieval/context-engine';
import { parseIntent } from '../intelligence/intent-engine';
import { isDemo, complete } from '../ai';
import { recordActivity } from '../../server/services/activity';
import { NexusError, toNexusError } from '../errors';
import type { PermissionLevel } from '@/types';

export interface SingleAgentInput {
  agentKey: string;
  instruction: string;
  userId: string;
  workspaceId: string;
  projectId?: string | null;
}

export async function runSingleAgent(input: SingleAgentInput) {
  const agent = getAgent(input.agentKey);
  if (!agent) throw new NexusError('NOT_FOUND', `Unknown agent: ${input.agentKey}`);

  const intent = await parseIntent({
    rawInput: input.instruction,
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId ?? null,
  });

  const intentRow = await prisma.intent.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId ?? null,
      rawInput: input.instruction,
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
      status: 'EXECUTING',
      mode: isDemo() ? 'DEMO' : 'REAL',
    },
  });

  const agentRow = await prisma.agent.upsert({
    where: { key: agent.key },
    create: {
      key: agent.key,
      name: agent.name,
      description: agent.description,
      category: agent.category,
      systemPrompt: agent.systemPrompt,
      capabilities: JSON.stringify(agent.capabilities),
      allowedTools: JSON.stringify(agent.allowedTools),
      permissionLevel: agent.permissionLevel,
    },
    update: {},
  });

  const run = await prisma.agentRun.create({
    data: {
      intentId: intentRow.id,
      agentId: agentRow.id,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      triggeredById: input.userId,
      status: 'RUNNING',
      startedAt: new Date(),
      mode: isDemo() ? 'DEMO' : 'REAL',
      input: JSON.stringify({ instruction: input.instruction }),
    },
  });

  const context = await buildContext({
    workspaceId: input.workspaceId,
    userId: input.userId,
    intent,
    rawInput: input.instruction,
    intentId: intentRow.id,
  });

  const policy = await loadPolicy(input.userId);
  const granted: PermissionLevel[] = [];
  const connected = (await prisma.integration.findMany({ where: { userId: input.userId, status: 'CONNECTED' }, select: { key: true } })).map((i) => i.key);

  const emit = async (label: string, detail?: string, status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'WAITING' = 'RUNNING') => {
    await prisma.runEvent.create({
      data: { runId: run.id, intentId: intentRow.id, type: 'AGENT', label, detail: detail ?? null, status, nodeId: agent.key },
    });
  };

  const callTool = async (toolKey: string, args: unknown): Promise<ToolOutcome> => {
    if (!agent.allowedTools.includes(toolKey)) {
      return { toolKey, status: 'FAILED', error: `Agent ${agent.key} may not call ${toolKey}`, permission: 'READ' };
    }
    const tool = toolRegistry.get(toolKey);
    if (!tool) return { toolKey, status: 'FAILED', error: `Unknown tool ${toolKey}`, permission: 'READ' };

    const decision = authorize(tool.permission, {
      roleCeiling: 'HIGH_IMPACT',
      policy,
      connectedIntegrations: connected,
      requiredIntegrations: tool.requiresIntegration ? [tool.requiresIntegration] : [],
      grantedApprovals: granted,
    });

    if (!decision.allowed && decision.requiresApproval) {
      const approval = await prisma.approval.create({
        data: {
          workspaceId: input.workspaceId,
          intentId: intentRow.id,
          runId: run.id,
          projectId: input.projectId ?? null,
          title: tool.name,
          description: tool.description,
          whatWillHappen: `NEXUS will call ${toolKey}.`,
          whyNeeded: `${tool.permission.replace('_', ' ')} actions need your approval.`,
          toolKey,
          toolArguments: JSON.stringify(args ?? {}),
          affectedData: JSON.stringify(['Workspace data']),
          permission: tool.permission,
          riskLevel: tool.permission === 'HIGH_IMPACT' ? 'HIGH' : 'MEDIUM',
          status: 'PENDING',
        },
      });

      await prisma.agentRun.update({ where: { id: run.id }, data: { status: 'WAITING_APPROVAL' } });
      await emit('Waiting for approval', `${toolKey} — ${tool.name}`, 'WAITING');

      const decisionResult = await waitForApproval(approval.id, run.id);
      if (decisionResult.decision === 'DENIED') {
        await prisma.approval.update({ where: { id: approval.id }, data: { status: 'DENIED', decidedAt: new Date(), decidedById: input.userId } });
        return { toolKey, status: 'DENIED', permission: tool.permission, approvalId: approval.id };
      }
      granted.push(tool.permission);
      await prisma.approval.update({ where: { id: approval.id }, data: { status: 'APPROVED', decidedAt: new Date(), decidedById: input.userId } });
      await prisma.agentRun.update({ where: { id: run.id }, data: { status: 'RUNNING' } });
    } else if (!decision.allowed) {
      return { toolKey, status: 'BLOCKED', error: decision.reason, permission: tool.permission };
    }

    const started = Date.now();
    try {
      const { result } = await toolRegistry.execute(toolKey, args, {
        userId: input.userId,
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        runId: run.id,
        intentId: intentRow.id,
        agentKey: agent.key,
        mode: isDemo() ? 'DEMO' : 'REAL',
      });
      // One-shot grant: the approval covered this action only.
      const grantedIndex = granted.indexOf(tool.permission);
      if (grantedIndex >= 0) granted.splice(grantedIndex, 1);

      await prisma.toolExecution.create({
        data: {
          runId: run.id,
          toolKey,
          arguments: JSON.stringify(args ?? {}),
          result: JSON.stringify(result ?? null),
          status: 'COMPLETED',
          permission: tool.permission,
          durationMs: Date.now() - started,
          startedAt: new Date(started),
          completedAt: new Date(),
        },
      });
      return { toolKey, status: 'COMPLETED', result, permission: tool.permission, durationMs: Date.now() - started };
    } catch (error) {
      const message = toNexusError(error).message;
      await prisma.toolExecution.create({
        data: {
          runId: run.id,
          toolKey,
          arguments: JSON.stringify(args ?? {}),
          status: 'FAILED',
          permission: tool.permission,
          error: message,
          durationMs: Date.now() - started,
          completedAt: new Date(),
        },
      });
      return { toolKey, status: 'FAILED', error: message, permission: tool.permission };
    }
  };

  const ctx: AgentContext = {
    runId: run.id,
    intentId: intentRow.id,
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId ?? null,
    intent,
    rawInput: input.instruction,
    context,
    plan: null,
    prior: {},
    callTool,
    emit,
    writeMemory: async () => undefined,
    ai: async (request) =>
      complete({
        ...request,
        messages: [
          { role: 'system', content: agent.systemPrompt },
          { role: 'user', content: JSON.stringify(request.variables ?? {}).slice(0, 12000) },
        ],
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
      }),
    mode: isDemo() ? 'DEMO' : 'REAL',
  };

  try {
    await emit(`${agent.name} started`, agent.description);
    const output: AgentOutput = await agent.execute(ctx);

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        durationMs: Date.now() - run.createdAt.getTime(),
        outputs: JSON.stringify(output.data ?? {}),
        tokens: output.tokens,
      },
    });
    await prisma.intent.update({ where: { id: intentRow.id }, data: { status: 'COMPLETED' } });
    await emit(`${agent.name} completed`, output.summary, 'COMPLETED');

    await recordActivity({
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId ?? null,
      intentId: intentRow.id,
      type: 'AGENT',
      action: `${agent.name} executed`,
      summary: output.summary,
      severity: 'SUCCESS',
    });

    return { intentId: intentRow.id, runId: run.id, output };
  } catch (error) {
    const e = toNexusError(error);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', completedAt: new Date(), durationMs: Date.now() - run.createdAt.getTime(), error: e.message, errorStep: agent.key },
    });
    await prisma.intent.update({ where: { id: intentRow.id }, data: { status: 'FAILED' } });
    await emit(`${agent.name} failed`, e.message, 'FAILED');
    throw e;
  }
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
