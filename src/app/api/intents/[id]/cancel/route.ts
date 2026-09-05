import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { cancelRun } from '@/lib/orchestration/orchestrator';
import { handler, ok } from '@/lib/api/response';

export const runtime = 'nodejs';

export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const runs = await prisma.agentRun.findMany({ where: { intentId: id }, select: { id: true } });
  for (const run of runs) cancelRun(run.id);

  await prisma.agentRun.updateMany({
    where: { intentId: id, status: { in: ['QUEUED', 'RUNNING', 'PLANNING', 'WAITING_APPROVAL'] } },
    data: { status: 'CANCELLED', completedAt: new Date(), error: 'Cancelled by user' },
  });
  await prisma.intent.update({ where: { id }, data: { status: 'CANCELLED' } });

  return ok({ cancelled: true, runs: runs.length });
});
