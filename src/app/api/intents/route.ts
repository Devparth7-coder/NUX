import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const limit = Math.min(50, Number(req.nextUrl.searchParams.get('limit') ?? 20));
  const intents = await prisma.intent.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      runs: { select: { id: true, status: true, agent: { select: { key: true, name: true } } } },
      _count: { select: { runs: true, artifacts: true, approvals: true } },
    },
  });
  return ok({ items: intents, total: intents.length });
});
