import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const type = req.nextUrl.searchParams.get('type');
  const projectId = req.nextUrl.searchParams.get('projectId');

  const artifacts = await prisma.artifact.findMany({
    where: {
      userId: user.id,
      ...(type ? { type } : {}),
      ...(projectId ? { projectId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { project: { select: { id: true, name: true } }, intent: { select: { id: true, objective: true } } },
  });
  return ok({ items: artifacts });
});
