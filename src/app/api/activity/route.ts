import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const type = req.nextUrl.searchParams.get('type');
  const limit = Math.min(200, Number(req.nextUrl.searchParams.get('limit') ?? 80));

  const items = await prisma.activity.findMany({
    where: { workspaceId: user.workspaceId, ...(type && type !== 'ALL' ? { type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      project: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });

  const counts = await prisma.activity.groupBy({
    by: ['type'],
    where: { workspaceId: user.workspaceId },
    _count: { _all: true },
  });

  return ok({ items, counts: Object.fromEntries(counts.map((c) => [c.type, c._count._all])) });
});
