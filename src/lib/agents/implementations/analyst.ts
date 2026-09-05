import type { AgentDefinition } from '../types';
import { asRecord, markdownTable } from '../helpers';

export const analystAgent: AgentDefinition = {
  key: 'analyst',
  name: 'Analyst Agent',
  description: 'Computes metrics, trends, comparisons and structured insights from live workspace data.',
  category: 'ANALYSIS',
  capabilities: ['analysis'],
  allowedTools: ['data.task_metrics', 'data.project_health', 'tasks.list', 'artifact.generate'],
  permissionLevel: 'READ',
  temperature: 0.1,
  maxTokens: 1800,
  icon: 'chart-no-axes-column',
  systemPrompt:
    'You analyse only measured data. Every figure you report is computed from persisted records; you state the sample size and never extrapolate silently.',

  async execute(ctx) {
    const [metrics, health] = await Promise.all([
      ctx.callTool('data.task_metrics', { projectId: ctx.projectId ?? undefined }),
      ctx.projectId ? ctx.callTool('data.project_health', { projectId: ctx.projectId }) : Promise.resolve(null),
    ]);

    const m = asRecord(metrics.result);
    const h = asRecord(health?.result);
    const byStatus = asRecord(m.byStatus);

    const metricRows: [string, string][] = [
      ['Total tasks', String(m.total ?? 0)],
      ['Completed', String(byStatus.DONE ?? 0)],
      ['In progress', String(byStatus.IN_PROGRESS ?? 0)],
      ['Blocked', String(byStatus.BLOCKED ?? 0)],
      ['Overdue', String(m.overdue ?? 0)],
      ['Completion rate', `${m.completionRate ?? 0}%`],
      ['Dependency conflicts', String(Array.isArray(m.dependencyConflicts) ? m.dependencyConflicts.length : 0)],
      ['Project health', String(h.health ?? '—')],
      ['Health score', String(h.healthScore ?? '—')],
    ];

    const insight = await ctx.ai({ task: 'analysis_insight', variables: { metrics: metricRows.map(([label, value]) => ({ label, value })) } });

    const content = [
      `# Workspace analysis`,
      '',
      insight.text,
      '',
      '## Metrics',
      markdownTable(['Metric', 'Value'], metricRows.map(([a, b]) => [a, b])),
      '',
      h.blockers ? `## Blockers\n${(h.blockers as string[]).map((b: string) => `- ${b}`).join('\n')}` : '',
      '',
      h.risks ? `## Risks\n${(h.risks as string[]).map((r: string) => `- ${r}`).join('\n')}` : '',
    ].join('\n');

    const artifact = await ctx.callTool('artifact.generate', {
      title: 'Workspace analysis',
      type: 'ANALYSIS',
      content,
      format: 'markdown',
      projectId: ctx.projectId ?? undefined,
    });

    return {
      agentKey: 'analyst',
      summary: `Computed ${metricRows.length} metrics across ${m.total ?? 0} task(s).`,
      data: { metrics: m, health: h, artifactId: asRecord(artifact.result).id ?? null },
      artifacts: [{ title: 'Workspace analysis', type: 'ANALYSIS', content, format: 'markdown' }],
      toolCalls: 3,
      tokens: insight.usage.totalTokens,
    };
  },
};
