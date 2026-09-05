import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok, validationError } from '@/lib/api/response';

export const runtime = 'nodejs';

const createSchema = z.object({ title: z.string().min(2).max(120).default('New conversation'), projectId: z.string().optional().nullable() });

export const GET = handler(async () => {
  const user = await requireUser();
  const items = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    take: 40,
    include: { _count: { select: { messages: true } }, project: { select: { id: true, name: true } } },
  });
  return ok({ items });
});

export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const conversation = await prisma.conversation.create({
    data: { workspaceId: user.workspaceId, userId: user.id, projectId: parsed.data.projectId ?? null, title: parsed.data.title },
  });
  return ok({ conversation }, { status: 201 });
});
