import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { toolRegistry, TOOL_CATEGORIES } from '@/lib/tools/registry';
import { handler, ok } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async () => {
  await requireUser();
  const rows = await prisma.tool.findMany();
  const stats = new Map(rows.map((r) => [r.key, r]));

  const tools = toolRegistry.list().map((tool) => ({
    ...tool,
    totalCalls: stats.get(tool.key)?.totalCalls ?? 0,
    failedCalls: stats.get(tool.key)?.failedCalls ?? 0,
    averageLatencyMs: stats.get(tool.key)?.totalCalls
      ? Math.round((stats.get(tool.key)?.totalLatencyMs ?? 0) / (stats.get(tool.key)?.totalCalls ?? 1))
      : null,
  }));

  return ok({ tools, categories: TOOL_CATEGORIES, total: tools.length });
});
