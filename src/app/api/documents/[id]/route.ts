import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { storage } from "@/lib/storage";
import { recordActivity } from "@/server/services/activity";

type Params = { id: string };

export const GET = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const doc = await prisma.document.findFirst({
    where: { id, workspaceId: ctx.auth.workspaceId },
    include: { project: { select: { id: true, name: true } }, chunks: { orderBy: { position: "asc" }, take: 60, select: { id: true, content: true, page: true, section: true, position: true, tokenCount: true } } },
  });
  if (!doc) throw Errors.notFound("Document");
  return ok({ document: doc });
});

export const DELETE = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const doc = await prisma.document.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!doc) throw Errors.notFound("Document");
  await storage().delete(doc.storageKey).catch(() => undefined);
  await prisma.document.delete({ where: { id: doc.id } });
  await recordActivity({
    workspaceId: ctx.auth.workspaceId,
    userId: ctx.auth.userId,
    projectId: doc.projectId,
    kind: "DOCUMENT",
    action: "document.delete",
    summary: `Deleted “${doc.title}”`,
    entityType: "DOCUMENT",
    entityId: doc.id,
    status: "warning",
  });
  return ok({ deleted: true });
});
