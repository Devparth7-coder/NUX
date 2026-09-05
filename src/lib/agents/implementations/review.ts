import type { AgentDefinition } from '../types';
import { prisma } from '../../db';
import { similarity } from '../../orchestration/planner';
import { asRecord, markdownTable } from '../helpers';

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

export const reviewAgent: AgentDefinition = {
  key: 'review',
  name: 'Review Agent',
  description: 'Validates results, checks consistency, detects errors and produces ranked recommendations.',
  category: 'REVIEW',
  capabilities: ['review'],
  allowedTools: ['tasks.list', 'data.task_metrics', 'data.project_health', 'artifact.generate'],
  permissionLevel: 'READ',
  temperature: 0.1,
  maxTokens: 2048,
  icon: 'shield-check',
  systemPrompt:
    'You verify. You check real records, report what passed and what failed, and recommend concrete next actions. You never mark something verified without checking it.',

  async execute(ctx) {
    const checks: Check[] = [];
    let toolCalls = 0;

    // 1. Plan coverage — do the planned tasks exist in the database now?
    const list = await ctx.callTool('tasks.list', { projectId: ctx.projectId ?? undefined, limit: 200 });
    toolCalls++;
    const tasks = Array.isArray(asRecord(list.result).tasks)
      ? (asRecord(list.result).tasks as unknown as { id: string; title: string; status: string; deadline: string | null; assignee: string | null }[])
      : [];

    const planned = ctx.plan?.tasks ?? [];
    const matched = planned.filter((p) => tasks.some((t) => similarity(p.title, t.title) > 0.6));
    checks.push({
      name: 'Plan coverage',
      passed: planned.length === 0 || matched.length === planned.length,
      detail: `${matched.length}/${planned.length} planned workstreams are present in the workspace.`,
    });

    // 2. Grounding — was the run actually grounded in retrieved context?
    checks.push({
      name: 'Context grounding',
      passed: ctx.context.items.length > 0,
      detail: `${ctx.context.items.length} context item(s) were retrieved and cited.`,
    });

    // 3. Tool health — did any tool call fail during this run?
    const failedTools = await prisma.toolExecution.findMany({
      where: { runId: { in: await siblingRunIds(ctx.intentId) }, status: { in: ['FAILED', 'VALIDATION_FAILED'] } },
      select: { toolKey: true, error: true },
    });
    checks.push({
      name: 'Tool execution health',
      passed: failedTools.length === 0,
      detail: failedTools.length
        ? `${failedTools.length} tool call(s) failed: ${failedTools.slice(0, 3).map((f) => f.toolKey).join(', ')}`
        : 'No tool call in this run failed.',
    });

    // 4. Deadline coherence
    const deadline = ctx.intent.deadline;
    const late = deadline
      ? tasks.filter((t) => t.deadline && new Date(t.deadline) > deadline && t.status !== 'DONE')
      : [];
    checks.push({
      name: 'Deadline coherence',
      passed: late.length === 0,
      detail: late.length
        ? `${late.length} scheduled task(s) fall after the stated deadline.`
        : 'All scheduled work falls within the stated deadline.',
    });

    // 5. Ownership
    const unassigned = tasks.filter((t) => !t.assignee && t.status !== 'DONE');
    checks.push({
      name: 'Ownership',
      passed: unassigned.length === 0,
      detail: `${unassigned.length} open task(s) have no assignee.`,
    });

    // 6. Artifacts produced
    const artifactCount = await prisma.artifact.count({ where: { intentId: ctx.intentId } });
    checks.push({
      name: 'Artifacts produced',
      passed: artifactCount > 0,
      detail: `${artifactCount} artifact(s) generated and stored.`,
    });

    // ── Recommendations derived from real state ──────────────────────────────
    const metrics = await ctx.callTool('data.task_metrics', { projectId: ctx.projectId ?? undefined });
    toolCalls++;
    const metricData = asRecord(metrics.result);

    const recommendations: string[] = [];
    if (Number(metricData.overdue ?? 0) > 0) {
      recommendations.push(`Clear or reschedule ${metricData.overdue} overdue task(s) before the deadline compresses further.`);
    }
    if (unassigned.length > 0) {
      recommendations.push(`Assign an owner to ${unassigned.length} open task(s): ${unassigned.slice(0, 2).map((t) => t.title).join(', ')}.`);
    }
    const blockedTasks = tasks.filter((t) => t.status === 'BLOCKED');
    if (blockedTasks.length) {
      recommendations.push(`Unblock ${blockedTasks.length} task(s) — they gate dependent work: ${blockedTasks.slice(0, 2).map((t) => t.title).join(', ')}.`);
    }
    if (ctx.intent.deadlineText) {
      recommendations.push(`Lock the ${ctx.intent.deadlineText} window: freeze scope 24h before go-live.`);
    }
    if (!recommendations.length) {
      recommendations.push('Workspace state is consistent. Proceed with the planned sequence.');
    }

    const report = await ctx.ai({
      task: 'review_report',
      variables: { checks },
    });

    const content = [
      `# Review report`,
      '',
      report.text,
      '',
      '## Recommendations',
      recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n'),
      '',
      '## Workspace metrics',
      markdownTable(
        ['Metric', 'Value'],
        [
          ['Open tasks', String(metricData.total ?? tasks.length)],
          ['Overdue', String(metricData.overdue ?? 0)],
          ['Completion rate', `${metricData.completionRate ?? 0}%`],
          ['Context items', String(ctx.context.items.length)],
          ['Artifacts', String(artifactCount)],
        ],
      ),
    ].join('\n');

    const artifact = await ctx.callTool('artifact.generate', {
      title: 'Review report',
      type: 'REPORT',
      content,
      format: 'markdown',
      projectId: ctx.projectId ?? undefined,
    });
    toolCalls++;

    return {
      agentKey: 'review',
      summary: `${checks.filter((c) => c.passed).length}/${checks.length} validation checks passed.`,
      data: {
        checks,
        recommendations,
        metrics: metricData,
        artifactId: asRecord(artifact.result).id ?? null,
      },
      artifacts: [{ title: 'Review report', type: 'REPORT', content, format: 'markdown' }],
      toolCalls,
      tokens: report.usage.totalTokens,
      recommendations,
    };
  },
};

async function siblingRunIds(intentId: string): Promise<string[]> {
  const runs = await prisma.agentRun.findMany({ where: { intentId }, select: { id: true } });
  return runs.map((r) => r.id);
}
