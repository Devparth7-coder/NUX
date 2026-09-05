import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const run = await prisma.agentRun.findFirst({
    where: { id, OR: [{ triggeredById: user.id }, { workspaceId: user.workspaceId }] },
    include: {
      agent: true,
      events: { orderBy: { createdAt: 'asc' } },
      toolExecutions: { orderBy: { createdAt: 'asc' } },
      approvals: true,
      artifacts: { select: { id: true, title: true, type: true } },
      intent: true,
    },
  });
  if (!run) throw notFound('Run not found');
  return ok({ run });
});
