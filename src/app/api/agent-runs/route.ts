import { prisma } from "@/lib/db";
import { route, ok, parsePage } from "@/lib/api";

export const GET = route({ auth: true }, async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const { skip, take, page, pageSize } = parsePage(sp, 25);
  const status = sp.get("status");
  const projectId = sp.get("projectId");
  const active = sp.get("active") === "true";

  const where = {
    workspaceId: ctx.auth.workspaceId,
    ...(status ? { status: status as never } : {}),
    ...(projectId ? { projectId } : {}),
    ...(active ? { status: { in: ["QUEUED" as never, "RUNNING" as never, "WAITING_APPROVAL" as never, "PLANNING" as never] } } : {}),
  };

  const [runs, total] = await Promise.all([
    prisma.agentRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        agent: { select: { key: true, name: true } },
        project: { select: { id: true, name: true } },
        intent: { select: { id: true, rawInput: true } },
        _count: { select: { children: true, toolExecutions: true } },
      },
    }),
    prisma.agentRun.count({ where }),
  ]);
  return ok({ page, pageSize, total, runs });
});
