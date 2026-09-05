import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { queue } from "@/lib/jobs/queue";
import { providerInfo } from "@/lib/ai";

/** Internal observability: latency, token usage, cost, retries, success rates. */
export const GET = route({ auth: true }, async (_req, ctx) => {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const workspaceId = ctx.auth.workspaceId;

  const [runsByStatus, agents, tools, modelCalls, approvals, errors] = await Promise.all([
    prisma.agentRun.groupBy({ by: ["status"], where: { workspaceId, createdAt: { gte: since } }, _count: { _all: true }, _avg: { latencyMs: true } }),
    prisma.agent.findMany({ where: { workspaceId }, select: { key: true, name: true, totalRuns: true, successRuns: true, totalLatencyMs: true, totalTokens: true, totalCostUsd: true, lastRunAt: true } }),
    prisma.tool.findMany({ where: { workspaceId }, select: { key: true, name: true, category: true, permissionLevel: true, totalCalls: true, failedCalls: true, totalLatencyMs: true, lastCalledAt: true } }),
    prisma.modelCall.groupBy({ by: ["purpose"], where: { workspaceId, createdAt: { gte: since } }, _count: { _all: true }, _sum: { tokensIn: true, tokensOut: true, costUsd: true, latencyMs: true }, _avg: { latencyMs: true } }),
    prisma.approval.groupBy({ by: ["status"], where: { workspaceId, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.activity.findMany({ where: { workspaceId, status: "error", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, summary: true, detail: true, createdAt: true } }),
  ]);

  return ok({
    window: "7d",
    queue: queue.stats(),
    ai: providerInfo(),
    runs: {
      byStatus: runsByStatus.map((r) => ({ status: r.status, count: r._count._all, avgLatencyMs: Math.round(r._avg.latencyMs ?? 0) })),
    },
    agents: agents.map((a) => ({
      ...a,
      successRate: a.totalRuns ? Number((a.successRuns / a.totalRuns).toFixed(3)) : null,
      avgLatencyMs: a.totalRuns ? Math.round(a.totalLatencyMs / a.totalRuns) : null,
    })),
    tools: tools.map((t) => ({ ...t, avgLatencyMs: t.totalCalls ? Math.round(t.totalLatencyMs / t.totalCalls) : null })),
    modelCalls: modelCalls.map((m) => ({
      purpose: m.purpose,
      calls: m._count._all,
      tokensIn: m._sum.tokensIn ?? 0,
      tokensOut: m._sum.tokensOut ?? 0,
      costUsd: Number((m._sum.costUsd ?? 0).toFixed(4)),
      avgLatencyMs: Math.round(m._avg.latencyMs ?? 0),
    })),
    approvals: approvals.map((a) => ({ status: a.status, count: a._count._all })),
    errors,
  });
});
