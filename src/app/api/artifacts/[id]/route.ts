import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const artifact = await prisma.artifact.findFirst({ where: { id, userId: user.id } });
  if (!artifact) throw notFound('Artifact not found');
  return ok({ artifact });
});

export const DELETE = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await prisma.artifact.deleteMany({ where: { id, userId: user.id } });
  return ok({ deleted: true });
});
