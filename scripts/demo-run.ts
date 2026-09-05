/* End-to-end verification of the NEXUS pipeline (no HTTP, no UI). */
import { prisma } from '../src/lib/db';
import { startRun } from '../src/lib/orchestration/orchestrator';
import { resolveApproval } from '../src/lib/orchestration/approvals';

async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'demo@nexus.ai' }, include: { memberships: true } });
  if (!user) throw new Error('Run `npm run db:seed` first');
  const workspaceId = user.memberships[0]!.workspaceId;

  const input = process.argv[2] ?? 'I want to launch NEXUS this week.';
  console.log(`\n▶ COMMAND: "${input}"\n`);

  const { intentId } = await startRun({ userId: user.id, workspaceId, rawInput: input });

  // Wait for terminal-ish state.
  let status = '';
  for (let i = 0; i < 120; i++) {
    const intent = await prisma.intent.findUnique({ where: { id: intentId } });
    status = intent?.status ?? '';
    if (['COMPLETED', 'FAILED', 'WAITING_APPROVAL', 'CANCELLED'].includes(status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const intent = await prisma.intent.findUnique({
    where: { id: intentId },
    include: {
      contextItems: true,
      runs: { include: { agent: true, events: true, toolExecutions: true } },
      approvals: true,
      artifacts: true,
    },
  });

  console.log('─ INTENT ───────────────────────────────');
  console.log(`  objective      : ${intent!.objective}`);
  console.log(`  desired outcome: ${intent!.desiredOutcome}`);
  console.log(`  deadline       : ${intent!.deadlineText} (${intent!.deadline?.toISOString() ?? '—'})`);
  console.log(`  capabilities   : ${intent!.requiredCapabilities}`);
  console.log(`  risk           : ${intent!.riskLevel}   confidence ${intent!.confidence}`);
  console.log(`  entities       : ${JSON.parse(intent!.entities).map((e: { name: string }) => e.name).join(', ') || '—'}`);
  console.log(`  status         : ${intent!.status}`);

  console.log('\n─ CONTEXT ──────────────────────────────');
  console.log(`  ${intent!.contextItems.length} item(s) retrieved`);
  for (const item of intent!.contextItems.slice(0, 8)) {
    console.log(`   • [${item.sourceType}] ${item.title.slice(0, 52)} — relevance ${item.relevance.toFixed(3)}`);
    console.log(`     ${item.rationale.slice(0, 110)}`);
  }

  console.log('\n─ AGENT RUNS ───────────────────────────');
  for (const run of intent!.runs) {
    console.log(`  ${run.agent.name.padEnd(16)} ${run.status.padEnd(17)} ${run.durationMs ?? '—'}ms  tools:${run.toolExecutions.length}  events:${run.events.length}`);
    if (run.error) console.log(`     error: ${run.error}`);
  }

  const tools = intent!.runs.flatMap((r) => r.toolExecutions);
  console.log(`\n─ TOOL CALLS (${tools.length}) ────────────────────────`);
  for (const t of tools.slice(0, 20)) {
    console.log(`  ${t.toolKey.padEnd(22)} ${t.status.padEnd(10)} ${t.durationMs ?? '—'}ms  perm=${t.permission}`);
    if (t.error) console.log(`     ${t.error.slice(0, 110)}`);
  }

  console.log(`\n─ APPROVALS (${intent!.approvals.length}) ─────────────────────`);
  for (const a of intent!.approvals) {
    console.log(`  ${a.toolKey} · ${a.permission} · ${a.riskLevel} · ${a.status}`);
    console.log(`     ${a.whatWillHappen}`);
    console.log(`     affected: ${JSON.parse(a.affectedData).join(', ')}`);
  }

  console.log(`\n─ ARTIFACTS (${intent!.artifacts.length}) ─────────────────────`);
  for (const a of intent!.artifacts) console.log(`  [${a.type}] ${a.title} — ${a.content.length} chars`);

  const events = await prisma.runEvent.findMany({ where: { intentId }, orderBy: { createdAt: 'asc' } });
  console.log(`\n─ TIMELINE (${events.length} events) ──────────────────`);
  for (const e of events.slice(0, 40)) {
    const t = e.createdAt.toTimeString().slice(0, 8);
    console.log(`  ${t}  ${e.type.padEnd(10)} ${e.label.slice(0, 58)}${e.detail ? ` · ${e.detail.slice(0, 70)}` : ''}`);
  }

  // Approve anything pending and confirm execution continues.
  const pending = intent!.approvals.filter((a) => a.status === 'PENDING');
  if (pending.length) {
    console.log(`\n▶ APPROVING ${pending.length} pending action(s)…`);
    for (const approval of pending) {
      await prisma.approval.update({ where: { id: approval.id }, data: { status: 'APPROVED', decidedAt: new Date(), decidedById: user.id } });
      resolveApproval(approval.id, { decision: 'APPROVED' });
    }
    await new Promise((r) => setTimeout(r, 6000));
    const after = await prisma.intent.findUnique({ where: { id: intentId }, include: { approvals: true, artifacts: true, runs: { include: { toolExecutions: true } } } });
    console.log(`  intent status: ${after!.status}`);
    for (const a of after!.approvals) console.log(`  ${a.toolKey}: ${a.status}${a.result ? ` → ${String(a.result).slice(0, 90)}` : ''}`);
    const drafts = await prisma.emailDraft.count({ where: { workspaceId } });
    const events2 = await prisma.calendarEvent.count({ where: { workspaceId } });
    console.log(`  email drafts in DB: ${drafts} · calendar events in DB: ${events2}`);
  }

  const memories = await prisma.memory.count({ where: { workspaceId } });
  const tasks = await prisma.task.count({ where: { workspaceId } });
  console.log(`\n  memories: ${memories} · tasks: ${tasks}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
