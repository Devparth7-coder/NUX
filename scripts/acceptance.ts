/**
 * Final acceptance run against the live HTTP server.
 *
 * 1. Login (real session cookie).
 * 2. POST the acceptance command.
 * 3. Stream the SSE timeline until the run reaches a terminal / approval state.
 * 4. Print every step, the approvals, and the final result.
 *
 * Usage: BASE=http://localhost:3000 npx tsx scripts/acceptance.ts "Prepare my NEXUS launch for this week."
 */

const BASE = process.env.BASE ?? 'http://localhost:3000';
const INPUT = process.argv[2] ?? 'Prepare my NEXUS launch for this week.';

let cookie = '';

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return data as Record<string, unknown>;
}

function unwrap<T>(payload: unknown): T {
  const value = payload as { data?: unknown };
  return (value?.data ?? payload) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n══ NEXUS ACCEPTANCE RUN ══════════════════════════════════════');
  console.log(`BASE  ${BASE}`);
  console.log(`CMD   "${INPUT}"\n`);

  // 1 ── Health / mode
  const health = unwrap<{ mode: string; provider: { id: string; label: string }; tools: number; agents: number }>(
    await call('/api/health'),
  );
  console.log(`MODE  ${health.mode}  ·  provider ${health.provider.id}  ·  ${health.tools} tools  ·  ${health.agents} agents`);

  // 2 ── Login
  await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'demo@nexus.ai', password: 'nexus-demo-2026' }),
  });
  console.log('AUTH  session established\n');

  // 3 ── Send the command
  const start = unwrap<{ intentId: string }>(await call('/api/command', { method: 'POST', body: JSON.stringify({ input: INPUT }) }));
  const intentId = start.intentId;
  console.log(`INTENT ${intentId}\n`);

  // 4 ── Poll the API (same data the SSE stream uses) until settled
  let seen = 0;
  let state: Record<string, unknown> | null = null;
  for (let i = 0; i < 120; i++) {
    state = unwrap<Record<string, unknown>>(await call(`/api/intents/${intentId}`));
    const intent = state.intent as { status: string } | undefined;
    if (intent && ['COMPLETED', 'FAILED', 'WAITING_APPROVAL', 'CANCELLED'].includes(intent.status)) {
      // drain remaining events once
      await sleep(600);
      state = unwrap<Record<string, unknown>>(await call(`/api/intents/${intentId}`));
      break;
    }
    await sleep(500);
  }

  const intent = state!.intent as {
    objective: string;
    deadlineText: string | null;
    riskLevel: string;
    confidence: number;
    status: string;
    requiredCapabilities: string;
    entities: string;
    mode: string;
    result: string | null;
    contextItems: { sourceType: string; title: string; relevance: number; rationale: string }[];
    runs: {
      id: string;
      status: string;
      durationMs: number | null;
      tokens: number | null;
      toolExecutions: { toolKey: string; status: string; permission: string }[];
      agent: { name: string };
    }[];
    approvals: { id: string; title: string; toolKey: string; permission: string; riskLevel: string; status: string; whatWillHappen: string }[];
    artifacts: { title: string; type: string; createdAt: string }[];
  };
  const events = (state!.events ?? []) as { id: string; label: string; type: string; status: string; detail: string | null; createdAt: string }[];
  const runs = intent.runs ?? [];
  const approvals = intent.approvals ?? [];
  const contextItems = intent.contextItems ?? [];
  const artifacts = intent.artifacts ?? [];
  const result = state!.result as {
    summary?: string;
    tasks?: unknown[];
    recommendations?: unknown[];
    approvals?: unknown[];
    validation?: { passed: boolean; checks: { name: string; passed: boolean; detail: string }[] };
  } | null;

  console.log('── 1-2 INTENT ────────────────────────────────────────────────');
  console.log(`  objective      : ${intent.objective}`);
  console.log(`  deadline       : ${intent.deadlineText ?? '—'}`);
  console.log(`  risk           : ${intent.riskLevel}   confidence ${intent.confidence}`);
  console.log(`  capabilities   : ${intent.requiredCapabilities}`);
  console.log(`  status         : ${intent.status}   mode ${intent.mode}`);

  console.log('\n── 3 CONTEXT RETRIEVAL ───────────────────────────────────────');
  console.log(`  ${contextItems.length} item(s)`);
  for (const item of contextItems.slice(0, 8)) {
    console.log(`   • [${item.sourceType}] ${item.title.slice(0, 50)} · ${item.relevance.toFixed(3)}`);
  }

  console.log('\n── 4-6 PLAN · AGENTS · GRAPH ─────────────────────────────────');
  for (const run of runs) {
    console.log(`  ${run.agent.name.padEnd(16)} ${run.status.padEnd(17)} ${String(run.durationMs ?? '—').padStart(5)}ms  tools:${run.toolExecutions.length}`);
  }

  console.log('\n── 7-9 EXECUTION · PERMISSION · APPROVAL ─────────────────────');
  const tools = runs.flatMap((r) => r.toolExecutions);
  console.log(`  ${tools.length} tool call(s)`);
  const byKey = new Map<string, number>();
  for (const t of tools) byKey.set(t.toolKey, (byKey.get(t.toolKey) ?? 0) + 1);
  for (const [key, count] of byKey) console.log(`   • ${key} ×${count}`);
  console.log(`  approvals: ${approvals.length}`);
  for (const a of approvals) {
    console.log(`   ⚠ ${a.title} · ${a.toolKey} · ${a.permission} · ${a.riskLevel} · ${a.status}`);
  }

  console.log('\n── 10 PIPELINE TIMELINE (SSE events) ─────────────────────────');
  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  ordered.forEach((event, index) => {
    const detail = event.detail ? `  — ${event.detail.slice(0, 78)}` : '';
    console.log(`  ${String(index + 1).padStart(2)}. [${event.status.padEnd(9)}] ${event.label}${detail}`);
  });
  seen = ordered.length;
  console.log(`  (${seen} events)`);

  // 5 ── Approve every pending approval (sequentially: each gate unlocks the next)
  console.log('\n── 11-14 USER APPROVES · EXECUTION RESUMES ───────────────────');
  let finalState = state!;
  for (let round = 0; round < 5; round++) {
    const current = finalState.intent as typeof intent;
    const pending = (current.approvals ?? []).filter((a) => a.status === 'PENDING');
    if (!pending.length) break;
    for (const approval of pending) {
      await call(`/api/approvals/${approval.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED' }) });
      console.log(`  ✓ approved ${approval.toolKey} (${approval.permission} · ${approval.riskLevel})`);
    }
    for (let i = 0; i < 120; i++) {
      finalState = unwrap<Record<string, unknown>>(await call(`/api/intents/${intentId}`));
      const st = (finalState.intent as { status: string }).status;
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(st)) break;
      const pend = ((finalState.intent as typeof current).approvals ?? []).filter((a) => a.status === 'PENDING');
      if (pend.length) break;
      await sleep(500);
    }
  }

  const after = finalState;
  const finalIntent = after.intent as { status: string; result: string | null };
  const parsedResult = finalIntent.result
    ? (JSON.parse(finalIntent.result) as {
        agents: string[];
        tools: string[];
        approvals: { title: string; toolKey: string; permission: string; status: string }[];
        result: {
          summary: string;
          taskCount: number;
          tasksCreated: number;
          tasksScheduled: number;
          recommendations: string[];
          validation: { passed: boolean; passedChecks: number; checks: { name: string; passed: boolean; detail: string }[] };
        };
        memoryUpdates: { content: string; type: string; importance: number }[];
      })
    : null;
  const finalResult = parsedResult?.result ?? null;

  console.log('\n── 15-20 RESULT ──────────────────────────────────────────────');
  console.log(`  final status: ${finalIntent.status}`);
  if (finalResult) {
    console.log(`  tasks            : ${finalResult.taskCount} (${finalResult.tasksCreated} created, ${finalResult.tasksScheduled} scheduled)`);
    console.log(`  recommendations  : ${finalResult.recommendations?.length ?? 0}`);
    for (const r of finalResult.recommendations ?? []) console.log(`     • ${r}`);
    console.log(`  validation       : ${finalResult.validation?.passed ? `PASSED (${finalResult.validation.passedChecks}/${finalResult.validation.checks.length})` : 'FAILED'}`);
    for (const c of finalResult.validation?.checks ?? []) {
      console.log(`     ${c.passed ? '✓' : '✗'} ${c.name} — ${c.detail}`);
    }
  }
  if (parsedResult) {
    console.log(`  agents registered: ${(parsedResult.agents ?? []).join(', ')}`);
    console.log(`  tools invoked    : ${(parsedResult.tools ?? []).join(', ')}`);
    console.log(`  approvals        : ${(parsedResult.approvals ?? []).length}`);
    for (const a of parsedResult.approvals ?? []) console.log(`     ⚠ ${a.toolKey} · ${a.permission} · ${a.status}`);
    console.log(`  memory updates   : ${(parsedResult.memoryUpdates ?? []).length}`);
    for (const m of parsedResult.memoryUpdates ?? []) console.log(`     • [${m.type} ${m.importance}] ${m.content.slice(0, 90)}`);
  }
  console.log(`  artifacts   : ${artifacts.length}`);
  for (const a of artifacts) console.log(`     • [${a.type}] ${a.title}`);

  // 6 ── Persistence check
  const [taskCount, memoryCount, activityCount] = await Promise.all([
    call('/api/tasks').then((r) => unwrap<{ tasks?: unknown[]; items?: unknown[] }>(r)),
    call('/api/memory').then((r) => unwrap<{ items?: unknown[]; memories?: unknown[] }>(r)),
    call('/api/activity?limit=200').then((r) => unwrap<{ items?: unknown[] }>(r)),
  ]);
  console.log('\n── PERSISTED STATE ───────────────────────────────────────────');
  console.log(`  tasks      : ${(taskCount.tasks ?? taskCount.items ?? []).length}`);
  console.log(`  memories   : ${(memoryCount.memories ?? memoryCount.items ?? []).length}`);
  console.log(`  activity   : ${(activityCount.items ?? []).length}`);
  console.log('\n══ DONE ══════════════════════════════════════════════════════\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
