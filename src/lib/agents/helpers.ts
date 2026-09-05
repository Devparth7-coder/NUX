import type { AgentContext, ToolOutcome } from './types';

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function outcomeData(outcome: ToolOutcome): Record<string, unknown> {
  return asRecord(outcome.result);
}

export function isBlocked(outcome: ToolOutcome): boolean {
  return outcome.status === 'BLOCKED' || outcome.status === 'DENIED' || outcome.status === 'FAILED';
}

/** Pull usable text out of whatever a tool returned. */
export function textOf(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  const rec = asRecord(value);
  if (typeof rec.content === 'string') return rec.content;
  if (typeof rec.snippet === 'string') return rec.snippet;
  if (typeof rec.summary === 'string') return rec.summary;
  if (typeof rec.error === 'string') return `error: ${rec.error}`;
  return fallback;
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

export function planMarkdown(ctx: AgentContext, plan: {
  objective: string;
  tasks: { title: string; description: string; priority: string; dueDate: Date | null; rationale: string }[];
  risks: { title: string; severity: string; mitigation: string }[];
  milestones: { title: string; description: string; dueDate: Date | null }[];
}, narrative: string): string {
  return [
    `# Execution plan — ${plan.objective}`,
    '',
    narrative,
    '',
    '## Workstreams',
    markdownTable(
      ['#', 'Task', 'Priority', 'Due', 'Why this task'],
      plan.tasks.map((t, i) => [
        String(i + 1),
        t.title,
        t.priority,
        t.dueDate ? t.dueDate.toISOString().slice(0, 10) : '—',
        t.rationale,
      ]),
    ),
    '',
    '## Milestones',
    markdownTable(
      ['Milestone', 'Description', 'Due'],
      plan.milestones.map((m) => [m.title, m.description, m.dueDate ? m.dueDate.toISOString().slice(0, 10) : '—']),
    ),
    '',
    '## Risks',
    plan.risks.length
      ? markdownTable(['Risk', 'Severity', 'Mitigation'], plan.risks.map((r) => [r.title, r.severity, r.mitigation]))
      : '_No risks detected from current workspace state._',
    '',
    `---`,
    `Grounded in ${ctx.context.items.length} retrieved context item(s). Mode: ${ctx.mode}.`,
  ].join('\n');
}
