import type { AgentDefinition } from '../types';
import { similarity } from '../../orchestration/planner';
import { asRecord, markdownTable } from '../helpers';

export const executionAgent: AgentDefinition = {
  key: 'execution',
  name: 'Execution Agent',
  description: 'Executes permitted actions: creates and schedules tasks, updates project state, prepares external actions for approval.',
  category: 'EXECUTION',
  capabilities: ['execution', 'task_management', 'integration'],
  allowedTools: ['tasks.create', 'tasks.update', 'tasks.list', 'projects.update', 'email.draft', 'calendar.create', 'artifact.generate'],
  permissionLevel: 'EXTERNAL_ACTION',
  temperature: 0.2,
  maxTokens: 2048,
  icon: 'zap',
  systemPrompt:
    'You perform work the user has authorised. You never execute an action that requires a permission you have not been granted, and you stop and request approval before anything leaves the workspace.',

  async execute(ctx) {
    const plan = ctx.plan;
    if (!plan) {
      return {
        agentKey: 'execution',
        summary: 'No plan was available to execute.',
        data: { executed: false },
        artifacts: [],
        toolCalls: 0,
        tokens: 0,
      };
    }

    const list = await ctx.callTool('tasks.list', { projectId: ctx.projectId ?? undefined, limit: 200 });
    const existing = Array.isArray(asRecord(list.result).tasks)
      ? (asRecord(list.result).tasks as unknown as { id: string; title: string; status: string }[])
      : [];

    const created: { title: string; id: string }[] = [];
    const updated: { title: string; id: string }[] = [];
    const approvals: { toolKey: string; approvalId?: string; title: string; status: string }[] = [];
    const blocked: { title: string; reason: string }[] = [];
    let toolCalls = 1;

    for (const task of plan.tasks) {
      const match = existing
        .map((t) => ({ t, score: similarity(task.title, t.title) }))
        .sort((a, b) => b.score - a.score)[0];

      if (match && match.score > 0.6) {
        await ctx.emit('Reconciling existing task', match.t.title);
        const outcome = await ctx.callTool('tasks.update', {
          taskId: match.t.id,
          deadline: task.dueDate ? task.dueDate.toISOString() : undefined,
          priority: task.priority,
        });
        toolCalls++;
        if (outcome.status === 'COMPLETED') updated.push({ title: match.t.title, id: match.t.id });
        else blocked.push({ title: match.t.title, reason: String(asRecord(outcome.result).error ?? outcome.error ?? outcome.status) });
      } else {
        await ctx.emit('Creating task', task.title);
        const outcome = await ctx.callTool('tasks.create', {
          title: task.title,
          description: task.description,
          priority: task.priority,
          projectId: ctx.projectId ?? undefined,
          deadline: task.dueDate ? task.dueDate.toISOString() : undefined,
          dependsOnTitles: task.dependsOnTitles,
        });
        toolCalls++;
        if (outcome.status === 'COMPLETED') {
          created.push({ title: task.title, id: String(asRecord(outcome.result).id ?? '') });
        } else if (outcome.status === 'BLOCKED' || outcome.status === 'FAILED') {
          blocked.push({ title: task.title, reason: String(asRecord(outcome.result).error ?? outcome.error ?? outcome.status) });
        } else if (outcome.status === 'DENIED') {
          blocked.push({ title: task.title, reason: 'Denied by user' });
        }
      }
    }

    // ── External actions: staged behind the approval gate ────────────────────
    const objective = ctx.intent.objective.toLowerCase();
    const wantsExternal =
      ctx.intent.permissionsRequired.includes('EXTERNAL_ACTION') ||
      objective.startsWith('launch') ||
      objective.startsWith('execute');

    if (wantsExternal) {
      const projectName = ctx.intent.entities.find((e) => e.type === 'PROJECT')?.name ?? 'the project';

      await ctx.emit('Preparing announcement draft', 'Awaiting approval');
      const email = await ctx.callTool('email.draft', {
        subject: `${projectName} — launch announcement`,
        body: [
          `Hi there,`,
          ``,
          `${projectName} is ready. Here is what changed and why it matters.`,
          ``,
          ...plan.tasks.slice(0, 4).map((t) => `- ${t.title}`),
          ``,
          `— The ${projectName} team`,
        ].join('\n'),
      });
      toolCalls++;
      approvals.push({
        toolKey: 'email.draft',
        approvalId: email.approvalId,
        title: 'Draft launch announcement email',
        status: email.status,
      });

      const reviewStart = new Date((ctx.intent.deadline?.getTime() ?? Date.now() + 3 * 86_400_000) - 3 * 3_600_000);
      await ctx.emit('Scheduling go-live review', 'Awaiting approval');
      const calendar = await ctx.callTool('calendar.create', {
        title: `${projectName} — go-live review`,
        description: 'Final go/no-go before release.',
        startsAt: reviewStart.toISOString(),
        endsAt: new Date(reviewStart.getTime() + 30 * 60_000).toISOString(),
      });
      toolCalls++;
      approvals.push({
        toolKey: 'calendar.create',
        approvalId: calendar.approvalId,
        title: 'Schedule go-live review',
        status: calendar.status,
      });
    }

    // ── Project state ───────────────────────────────────────────────────────
    if (ctx.projectId) {
      await ctx.callTool('projects.update', {
        projectId: ctx.projectId,
        objective: ctx.intent.objective,
        deadline: ctx.intent.deadline ? ctx.intent.deadline.toISOString() : undefined,
      });
      toolCalls++;
    }

    const content = [
      `# Execution report`,
      '',
      `**Tasks created:** ${created.length}  `,
      `**Existing tasks scheduled:** ${updated.length}  `,
      `**Blocked or denied:** ${blocked.length}  `,
      `**Approvals requested:** ${approvals.filter((a) => a.status === 'BLOCKED').length}`,
      '',
      created.length
        ? `## Created\n${markdownTable(['Task', 'ID'], created.map((c) => [c.title, c.id.slice(0, 8)]))}`
        : '_No new tasks were required — every planned workstream already existed and was scheduled instead._',
      '',
      updated.length
        ? `## Scheduled\n${markdownTable(['Task', 'ID'], updated.map((u) => [u.title, u.id.slice(0, 8)]))}`
        : '',
      blocked.length
        ? `## Blocked\n${markdownTable(['Task', 'Reason'], blocked.map((b) => [b.title, b.reason]))}`
        : '',
      '',
      `## Approvals`,
      approvals.length
        ? markdownTable(['Action', 'Status', 'Approval'], approvals.map((a) => [a.title, a.status, a.approvalId?.slice(0, 8) ?? '—']))
        : '_No external actions were staged._',
    ].join('\n');

    const artifact = await ctx.callTool('artifact.generate', {
      title: 'Execution report',
      type: 'REPORT',
      content,
      format: 'markdown',
      projectId: ctx.projectId ?? undefined,
    });
    toolCalls++;

    return {
      agentKey: 'execution',
      summary: `Created ${created.length} task(s), scheduled ${updated.length} existing task(s), staged ${approvals.length} external action(s) for approval.`,
      data: {
        created,
        updated,
        blocked,
        approvals,
        taskTotal: plan.tasks.length,
        artifactId: asRecord(artifact.result).id ?? null,
      },
      artifacts: [{ title: 'Execution report', type: 'REPORT', content, format: 'markdown' }],
      toolCalls,
      tokens: 0,
    };
  },
};
