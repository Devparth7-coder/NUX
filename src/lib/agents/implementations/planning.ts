import type { AgentDefinition } from '../types';
import type { ExecutionPlan } from '@/types';
import { buildPlan } from '../../orchestration/planner';
import { asArray, asRecord, markdownTable, planMarkdown } from '../helpers';

export const planningAgent: AgentDefinition = {
  key: 'planning',
  name: 'Planning Agent',
  description: 'Decomposes objectives into milestones, dependency-aware tasks, timelines and risks.',
  category: 'PLANNING',
  capabilities: ['planning', 'task_management'],
  allowedTools: ['tasks.list', 'projects.read', 'data.project_health', 'artifact.generate'],
  permissionLevel: 'WRITE',
  temperature: 0.2,
  maxTokens: 2048,
  icon: 'route',
  systemPrompt:
    'You decompose objectives into sequenced, dependency-aware work. You never invent facts: every task you propose is derived from the objective and the retrieved workspace state.',

  async execute(ctx) {
    await ctx.emit('Decomposing objective into workstreams');

    const [taskList, projectRead, health] = await Promise.all([
      ctx.callTool('tasks.list', { projectId: ctx.projectId ?? undefined, limit: 100 }),
      ctx.projectId ? ctx.callTool('projects.read', { projectId: ctx.projectId }) : Promise.resolve(null),
      ctx.projectId ? ctx.callTool('data.project_health', { projectId: ctx.projectId }) : Promise.resolve(null),
    ]);

    const existingTasks = asArray<Record<string, unknown>>(asRecord(taskList?.result).tasks).map((t) => ({
      id: String(t.id),
      title: String(t.title),
      status: String(t.status ?? 'TODO'),
      deadline: t.deadline ? new Date(String(t.deadline)) : null,
    }));

    const projectName = projectRead ? String(asRecord(projectRead.result).name ?? '') : null;
    const healthData = asRecord(health?.result);

    const plan: ExecutionPlan = buildPlan({
      intent: ctx.intent,
      rawInput: ctx.rawInput,
      projectName: projectName || null,
      existingTasks,
      projectHealth: {
        health: String(healthData.health ?? 'HEALTHY'),
        healthScore: Number(healthData.healthScore ?? 100),
        overdueTasks: Number(healthData.overdueTasks ?? 0),
        blockedTasks: Number(healthData.blockedTasks ?? 0),
      },
    });

    await ctx.emit(
      'Execution plan created',
      `${plan.tasks.length} workstreams, ${plan.milestones.length} milestones, ${plan.risks.length} risks`,
    );

    const narrative = await ctx.ai({
      task: 'plan_narrative',
      variables: {
        objective: plan.objective,
        deadlineText: ctx.intent.deadlineText ?? 'no explicit deadline',
        project: projectName ? { name: projectName } : null,
        steps: plan.tasks.map((t) => ({ title: t.title })),
        risks: plan.risks.map((r) => ({ title: r.title })),
      },
    });

    const content = planMarkdown(ctx, plan, narrative.text);

    const artifact = await ctx.callTool('artifact.generate', {
      title: `Execution plan — ${plan.objective}`,
      type: 'PLAN',
      content,
      format: 'markdown',
      projectId: ctx.projectId ?? undefined,
    });

    return {
      agentKey: 'planning',
      summary: `Decomposed "${plan.objective}" into ${plan.tasks.length} workstreams and ${plan.milestones.length} milestones.`,
      data: {
        plan,
        existingTaskCount: existingTasks.length,
        projectName,
        health: healthData,
        artifactId: asRecord(artifact.result).id ?? null,
      },
      artifacts: [{ title: `Execution plan — ${plan.objective}`, type: 'PLAN', content, format: 'markdown' }],
      toolCalls: 4,
      tokens: narrative.usage.totalTokens,
    };
  },
};
