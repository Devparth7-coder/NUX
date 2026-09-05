import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

/** Full run inspection: intent, context, runs, events, tools, approvals, artifacts. */
export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const intent = await prisma.intent.findFirst({
    where: { id, userId: user.id },
    include: {
      contextItems: { orderBy: { relevance: 'desc' } },
      runs: {
        include: {
          agent: { select: { key: true, name: true, category: true, description: true } },
          events: { orderBy: { createdAt: 'asc' } },
          toolExecutions: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      },
      approvals: true,
      artifacts: { select: { id: true, title: true, type: true, createdAt: true } },
      project: { select: { id: true, name: true } },
    },
  });

  if (!intent) throw notFound('Intent not found');

  const events = await prisma.runEvent.findMany({
    where: { intentId: id },
    orderBy: { createdAt: 'asc' },
  });

  return ok({ intent, events });
});
