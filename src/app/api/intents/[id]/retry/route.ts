import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { retryRun } from "@/server/pipeline/run-service";

type Params = { id: string };

export const POST = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const run = await prisma.agentRun.findFirst({ where: { intentId: id, parentRunId: null, workspaceId: ctx.auth.workspaceId } });
  if (!run) throw Errors.notFound("Run");
  const prefs = await prisma.userPreference.findUnique({ where: { userId: ctx.auth.userId } });
  await retryRun(run.id, ctx.auth.userId, prefs?.autoApproveRead ?? true);
  return ok({ retried: true, runId: run.id });
});
