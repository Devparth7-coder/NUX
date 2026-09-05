import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok, validationError } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

const patchSchema = z.object({ read: z.boolean() });

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const notification = await prisma.notification.findFirst({ where: { id, userId: user.id } });
  if (!notification) throw notFound('Notification not found');

  const updated = await prisma.notification.update({ where: { id }, data: { read: parsed.data.read } });
  return ok({ notification: updated });
});
