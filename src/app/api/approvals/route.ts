import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const status = req.nextUrl.searchParams.get('status');
  const items = await prisma.approval.findMany({
    where: {
      OR: [{ requestedById: user.id }, { intent: { userId: user.id } }],
      ...(status ? { status } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 50,
    include: {
      intent: { select: { id: true, objective: true, rawInput: true } },
      run: { select: { id: true, agent: { select: { name: true, key: true } } } },
      project: { select: { id: true, name: true } },
    },
  });
  return ok({ items, pending: items.filter((i) => i.status === 'PENDING').length });
});
