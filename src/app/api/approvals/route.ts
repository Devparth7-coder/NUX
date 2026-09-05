import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";

export const GET = route({ auth: true }, async (req, ctx) => {
  const status = new URL(req.url).searchParams.get("status");
  const approvals = await prisma.approval.findMany({
    where: { workspaceId: ctx.auth.workspaceId, ...(status ? { status: status as never } : {}) },
    orderBy: [{ createdAt: "desc" }],
    take: 60,
    include: {
      run: { select: { id: true, key: true, name: true, intentId: true } },
      toolExecution: { select: { id: true, input: true, status: true } },
    },
  });
  return ok({ approvals });
});
