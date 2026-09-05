import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { updateMemory, deleteMemory } from '@/lib/memory/service';
import { handler, ok, validationError } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

const patchSchema = z.object({
  content: z.string().min(4).max(4000).optional(),
  importance: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
  type: z.string().optional(),
});

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const memory = await prisma.memory.findFirst({ where: { id, workspaceId: user.workspaceId } });
  if (!memory) throw notFound('Memory not found');

  const updated = await updateMemory(id, parsed.data);
  return ok({ memory: updated });
});

export const DELETE = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const memory = await prisma.memory.findFirst({ where: { id, workspaceId: user.workspaceId } });
  if (!memory) throw notFound('Memory not found');
  await deleteMemory(id);
  return ok({ deleted: true });
});
