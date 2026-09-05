import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { cancelRun } from "@/server/pipeline/run-service";

type Params = { id: string };

export const POST = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const run = await prisma.agentRun.findFirst({ where: { intentId: id, parentRunId: null, workspaceId: ctx.auth.workspaceId } });
  if (!run) throw Errors.notFound("Run");
  await cancelRun(run.id, ctx.auth.userId);
  return ok({ cancelled: true });
});
