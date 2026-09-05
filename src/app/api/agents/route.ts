import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";

export const GET = route({ auth: true }, async (_req, ctx) => {
  const agents = await prisma.agent.findMany({
    where: { workspaceId: ctx.auth.workspaceId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { runs: true } },
      runs: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, latencyMs: true, createdAt: true } },
    },
  });
  return ok({
    agents: agents.map((a) => ({
      id: a.id,
      key: a.key,
      name: a.name,
      description: a.description,
      capabilities: a.capabilities,
      allowedTools: a.allowedTools,
      permissionLevel: a.permissionLevel,
      model: a.model,
      temperature: a.temperature,
      status: a.status,
      totalRuns: a.totalRuns,
      successRuns: a.successRuns,
      successRate: a.totalRuns ? Number((a.successRuns / a.totalRuns).toFixed(3)) : null,
      avgLatencyMs: a.totalRuns ? Math.round(a.totalLatencyMs / a.totalRuns) : null,
      totalTokens: a.totalTokens,
      totalCostUsd: a.totalCostUsd,
      lastRunAt: a.lastRunAt,
      recentRuns: a.runs,
    })),
  });
});
