import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok, validationError } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async () => {
  const user = await requireUser();
  const items = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return ok({ items, unread: items.filter((i) => !i.read).length });
});

const patchSchema = z.object({ markAllRead: z.boolean().optional() });

export const PATCH = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  if (parsed.data.markAllRead) {
    const result = await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
    return ok({ updated: result.count });
  }
  return ok({ updated: 0 });
});
