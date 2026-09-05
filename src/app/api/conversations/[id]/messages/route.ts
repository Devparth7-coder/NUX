import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      intents: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          runs: { include: { agent: { select: { key: true, name: true } } } },
          artifacts: { select: { id: true, title: true, type: true } },
          approvals: true,
          contextItems: { orderBy: { relevance: 'desc' }, take: 8 },
        },
      },
    },
  });
  return ok({ conversation });
});
