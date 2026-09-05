import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const status = req.nextUrl.searchParams.get('status');
  const runs = await prisma.agentRun.findMany({
    where: {
      OR: [{ triggeredById: user.id }, { workspaceId: user.workspaceId }],
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      agent: { select: { key: true, name: true, category: true } },
      intent: { select: { id: true, objective: true, rawInput: true, status: true } },
      _count: { select: { events: true, toolExecutions: true } },
    },
  });
  return ok({ items: runs });
});
