import type { AgentDefinition } from '../types';
import { asRecord } from '../helpers';

export const creativeAgent: AgentDefinition = {
  key: 'creative',
  name: 'Creative Agent',
  description: 'Produces launch copy, presentations, content and creative transformations grounded in workspace facts.',
  category: 'CREATIVE',
  capabilities: ['creative'],
  allowedTools: ['documents.search', 'knowledge.retrieve', 'artifact.generate'],
  permissionLevel: 'WRITE',
  temperature: 0.7,
  maxTokens: 2400,
  icon: 'sparkles',
  systemPrompt:
    'You write with restraint and precision. Every claim you make traces to retrieved workspace material; you do not invent features, numbers or customers.',

  async execute(ctx) {
    const projectName = ctx.intent.entities.find((e) => e.type === 'PROJECT')?.name ?? 'the project';
    const docs = await ctx.callTool('documents.search', { query: 'vision positioning audience value', limit: 4 });
    const hits = Array.isArray(asRecord(docs.result).hits)
      ? (asRecord(docs.result).hits as unknown as { documentTitle: string; snippet: string }[])
      : [];

    const facts = [
      ...hits.slice(0, 4).map((h) => `${h.documentTitle}: ${h.snippet.slice(0, 160)}`),
      ...(ctx.plan?.tasks.slice(0, 3).map((t) => `Planned: ${t.title}`) ?? []),
      ...(ctx.intent.deadlineText ? [`Target: ${ctx.intent.deadlineText}`] : []),
    ];

    const copy = await ctx.ai({
      task: 'creative_copy',
      variables: {
        subject: `${projectName} launch`,
        tone: 'confident, restrained, no hype',
        objective: ctx.intent.objective,
        facts,
      },
    });

    const content = [
      `# Launch copy — ${projectName}`,
      '',
      copy.text,
      '',
      '## Draft announcement',
      '',
      `**Subject:** ${projectName} is live`,
      '',
      `Today we're releasing ${projectName}. It understands what you're trying to do, gathers the context that matters, plans the work, and executes what you approve.`,
      '',
      ctx.plan?.tasks.length
        ? `**What's included**\n${ctx.plan.tasks.map((t) => `- ${t.title}`).join('\n')}`
        : '',
      '',
      '## Grounding',
      facts.length ? facts.map((f) => `- ${f}`).join('\n') : '_No workspace facts retrieved._',
    ].join('\n');

    const artifact = await ctx.callTool('artifact.generate', {
      title: `Launch copy — ${projectName}`,
      type: 'DOCUMENT',
      content,
      format: 'markdown',
      projectId: ctx.projectId ?? undefined,
    });

    return {
      agentKey: 'creative',
      summary: `Produced launch copy grounded in ${hits.length} retrieved passage(s).`,
      data: { projectName, facts, artifactId: asRecord(artifact.result).id ?? null },
      artifacts: [{ title: `Launch copy — ${projectName}`, type: 'DOCUMENT', content, format: 'markdown' }],
      toolCalls: 2,
      tokens: copy.usage.totalTokens,
    };
  },
};
