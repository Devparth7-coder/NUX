import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { retryRun } from "@/server/pipeline/run-service";

type Params = { id: string };

export const POST = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const prefs = await prisma.userPreference.findUnique({ where: { userId: ctx.auth.userId } });
  await retryRun(id, ctx.auth.userId, prefs?.autoApproveRead ?? true);
  return ok({ retried: true });
});
