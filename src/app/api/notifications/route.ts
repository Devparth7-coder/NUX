import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";

const Patch = z.object({ id: z.string().nullish(), markAllRead: z.boolean().default(false) });

export const GET = route({ auth: true }, async (_req, ctx) => {
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: ctx.auth.userId, archived: false }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { userId: ctx.auth.userId, read: false, archived: false } }),
  ]);
  const prefs = await prisma.notificationPrefs.findUnique({ where: { userId: ctx.auth.userId } });
  return ok({ notifications, unread, preferences: prefs ?? null });
});

export const PATCH = route<typeof Patch>({ body: Patch }, async (_req, ctx, input) => {
  if (input.body.markAllRead) {
    const result = await prisma.notification.updateMany({ where: { userId: ctx.auth.userId, read: false }, data: { read: true } });
    return ok({ updated: result.count });
  }
  if (!input.body.id) return ok({ updated: 0 });
  const updated = await prisma.notification.updateMany({
    where: { id: input.body.id, userId: ctx.auth.userId },
    data: { read: true },
  });
  return ok({ updated: updated.count });
});
