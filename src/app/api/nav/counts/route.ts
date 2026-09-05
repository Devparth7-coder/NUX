import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";

export const GET = route({ auth: true }, async (_req, ctx) => {
  const [pendingApprovals, unread, activeRuns] = await Promise.all([
    prisma.approval.count({ where: { workspaceId: ctx.auth.workspaceId, status: "PENDING" } }),
    prisma.notification.count({ where: { userId: ctx.auth.userId, read: false, archived: false } }),
    prisma.agentRun.count({
      where: {
        workspaceId: ctx.auth.workspaceId,
        parentRunId: null,
        status: { in: ["QUEUED", "RUNNING", "PLANNING", "WAITING_APPROVAL"] },
      },
    }),
  ]);
  return ok({ pendingApprovals, unread, activeRuns });
});
