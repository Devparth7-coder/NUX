import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";

type Params = { id: string };

export const GET = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const artifact = await prisma.artifact.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!artifact) throw Errors.notFound("Artifact");
  return ok({ artifact });
});

export const DELETE = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const artifact = await prisma.artifact.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!artifact) throw Errors.notFound("Artifact");
  await prisma.artifact.delete({ where: { id: artifact.id } });
  return ok({ deleted: true });
});
