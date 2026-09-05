import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';
import { AGENTS } from '@/lib/agents/registry';

export const runtime = 'nodejs';

/** Registry truth + persisted execution statistics. */
export const GET = handler(async () => {
  const user = await requireUser();
  const rows = await prisma.agent.findMany({ orderBy: { category: 'asc' } });

  const agents = AGENTS.map((agent) => {
    const row = rows.find((r) => r.key === agent.key);
    const runs = row?.totalRuns ?? 0;
    const success = row?.successRuns ?? 0;
    return {
      key: agent.key,
      name: agent.name,
      description: agent.description,
      category: agent.category,
      capabilities: agent.capabilities,
      allowedTools: agent.allowedTools,
      permissionLevel: agent.permissionLevel,
      icon: agent.icon,
      status: row?.status ?? 'IDLE',
      enabled: row?.enabled ?? true,
      totalRuns: runs,
      successRuns: success,
      failedRuns: row?.failedRuns ?? 0,
      successRate: runs ? Number(((success / runs) * 100).toFixed(1)) : null,
      averageLatencyMs: runs ? Math.round((row?.totalLatencyMs ?? 0) / runs) : null,
      totalTokens: row?.totalTokens ?? 0,
    };
  });

  const recentRuns = await prisma.agentRun.findMany({
    where: { OR: [{ triggeredById: user.id }, { workspaceId: user.workspaceId }] },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { agent: { select: { key: true, name: true } }, intent: { select: { objective: true } } },
  });

  return ok({ agents, recentRuns });
});
