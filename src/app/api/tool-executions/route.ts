import { prisma } from "@/lib/db";
import { route, ok, parsePage } from "@/lib/api";

export const GET = route({ auth: true }, async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const { skip, take, page, pageSize } = parsePage(sp, 40);
  const runId = sp.get("runId");
  const toolKey = sp.get("toolKey");
  const [executions, total] = await Promise.all([
    prisma.toolExecution.findMany({
      where: { workspaceId: ctx.auth.workspaceId, ...(runId ? { runId } : {}), ...(toolKey ? { toolKey } : {}) },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.toolExecution.count({ where: { workspaceId: ctx.auth.workspaceId, ...(runId ? { runId } : {}), ...(toolKey ? { toolKey } : {}) } }),
  ]);
  return ok({ page, pageSize, total, executions });
});
