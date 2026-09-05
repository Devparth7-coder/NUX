import { prisma } from "@/lib/db";
import { route, ok, parsePage } from "@/lib/api";

export const GET = route({ auth: true }, async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const { skip, take, page, pageSize } = parsePage(sp, 40);
  const kind = sp.get("kind");
  const projectId = sp.get("projectId");
  const status = sp.get("status");

  const where = {
    workspaceId: ctx.auth.workspaceId,
    ...(kind && kind !== "ALL" ? { kind: kind as never } : {}),
    ...(projectId ? { projectId } : {}),
    ...(status ? { status } : {}),
  };

  const [activity, total, counts] = await Promise.all([
    prisma.activity.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include: { user: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } } }),
    prisma.activity.count({ where }),
    prisma.activity.groupBy({ by: ["kind"], where: { workspaceId: ctx.auth.workspaceId }, _count: { _all: true } }),
  ]);

  return ok({ page, pageSize, total, activity, counts: counts.map((c) => ({ kind: c.kind, count: c._count._all })) });
});
