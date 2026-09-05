import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const approval = await prisma.approval.findFirst({
    where: { id, OR: [{ requestedById: user.id }, { intent: { userId: user.id } }] },
    include: { intent: { select: { id: true, objective: true, rawInput: true } } },
  });
  if (!approval) throw notFound('Approval not found');
  return ok({ approval });
});
