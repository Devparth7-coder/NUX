import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { approveAllForIntent } from "@/server/pipeline/approval-service";

type Params = { id: string };

export const POST = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const intent = await prisma.intent.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!intent) throw Errors.notFound("Intent");
  const approved = await approveAllForIntent(intent.id, ctx.auth.userId, ctx.auth.workspaceId);
  return ok({ approved });
});
