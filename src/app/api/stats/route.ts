import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';
import { getProvider } from '@/lib/ai';

export const runtime = 'nodejs';

/** Observability (§42): real latency, usage and success metrics. */
export const GET = handler(async () => {
  const user = await requireUser();

  const [runs, agentStats, toolStats, approvals] = await Promise.all([
    prisma.agentRun.findMany({
      where: { OR: [{ triggeredById: user.id }, { workspaceId: user.workspaceId }] },
      select: { status: true, durationMs: true, tokens: true, agentId: true, createdAt: true },
      take: 500,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.agent.findMany({ select: { key: true, name: true, totalRuns: true, successRuns: true, failedRuns: true, totalLatencyMs: true, totalTokens: true } }),
    prisma.toolExecution.findMany({ select: { toolKey: true, status: true, durationMs: true }, take: 1000, orderBy: { createdAt: 'desc' } }),
    prisma.approval.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const completed = runs.filter((r) => r.status === 'COMPLETED');
  const failed = runs.filter((r) => r.status === 'FAILED');
  const avgLatency = completed.length
    ? Math.round(completed.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / completed.length)
    : 0;

  const toolAgg = new Map<string, { calls: number; failures: number; latency: number }>();
  for (const exec of toolStats) {
    const entry = toolAgg.get(exec.toolKey) ?? { calls: 0, failures: 0, latency: 0 };
    entry.calls++;
    if (exec.status === 'FAILED') entry.failures++;
    entry.latency += exec.durationMs ?? 0;
    toolAgg.set(exec.toolKey, entry);
  }

  return ok({
    mode: getProvider().mode,
    runs: {
      total: runs.length,
      completed: completed.length,
      failed: failed.length,
      successRate: runs.length ? Number(((completed.length / runs.length) * 100).toFixed(1)) : null,
      averageLatencyMs: avgLatency,
      totalTokens: runs.reduce((sum, r) => sum + (r.tokens ?? 0), 0),
    },
    agents: agentStats.map((a) => ({
      key: a.key,
      name: a.name,
      runs: a.totalRuns,
      successRate: a.totalRuns ? Number(((a.successRuns / a.totalRuns) * 100).toFixed(1)) : null,
      averageLatencyMs: a.totalRuns ? Math.round(a.totalLatencyMs / a.totalRuns) : null,
      tokens: a.totalTokens,
    })),
    tools: [...toolAgg.entries()].map(([key, value]) => ({
      key,
      calls: value.calls,
      failures: value.failures,
      averageLatencyMs: value.calls ? Math.round(value.latency / value.calls) : null,
    })),
    approvals: Object.fromEntries(approvals.map((a) => [a.status, a._count._all])),
  });
});
