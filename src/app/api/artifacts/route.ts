import { prisma } from "@/lib/db";
import { route, ok, parsePage } from "@/lib/api";

export const GET = route({ auth: true }, async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const { skip, take, page, pageSize } = parsePage(sp, 30);
  const projectId = sp.get("projectId");
  const [artifacts, total] = await Promise.all([
    prisma.artifact.findMany({
      where: { workspaceId: ctx.auth.workspaceId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { project: { select: { id: true, name: true } } },
    }),
    prisma.artifact.count({ where: { workspaceId: ctx.auth.workspaceId, ...(projectId ? { projectId } : {}) } }),
  ]);
  return ok({ page, pageSize, total, artifacts });
});
