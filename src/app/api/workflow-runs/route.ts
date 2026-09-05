import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";

export const GET = route({ auth: true }, async (req, ctx) => {
  const workflowId = new URL(req.url).searchParams.get("workflowId");
  const runs = await prisma.workflowRun.findMany({
    where: { workspaceId: ctx.auth.workspaceId, ...(workflowId ? { workflowId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { workflow: { select: { id: true, name: true } } },
  });
  return ok({ runs });
});
