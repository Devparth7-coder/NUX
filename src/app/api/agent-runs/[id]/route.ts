import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";

type Params = { id: string };

export const GET = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const run = await prisma.agentRun.findFirst({
    where: { id, workspaceId: ctx.auth.workspaceId },
    include: {
      agent: true,
      project: { select: { id: true, name: true } },
      intent: { select: { id: true, rawInput: true, objective: true, deadlineText: true } },
      children: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { at: "asc" }, take: 300 },
      toolExecutions: { orderBy: { createdAt: "asc" } },
      approvals: true,
      artifacts: { select: { id: true, title: true, type: true, createdAt: true } },
      modelCalls: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) throw Errors.notFound("Run");

  const childIds = run.children.map((c) => c.id);
  const childExecutions = childIds.length
    ? await prisma.toolExecution.findMany({ where: { runId: { in: childIds } }, orderBy: { createdAt: "asc" } })
    : [];
  const childEvents = childIds.length
    ? await prisma.runEvent.findMany({ where: { runId: { in: childIds } }, orderBy: { at: "asc" }, take: 300 })
    : [];

  return ok({
    run,
    timeline: [...run.events, ...childEvents].sort((a, b) => a.at.getTime() - b.at.getTime()),
    executions: [...run.toolExecutions, ...childExecutions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  });
});
