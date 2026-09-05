import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { handler, ok, validationError } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

const patchSchema = z.object({ enabled: z.boolean().optional(), status: z.string().optional() });

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const agent = await prisma.agent.findFirst({ where: { OR: [{ id }, { key: id }] } });
  if (!agent) throw notFound('Agent not found');

  const updated = await prisma.agent.update({ where: { id: agent.id }, data: parsed.data });
  return ok({ agent: updated });
});
