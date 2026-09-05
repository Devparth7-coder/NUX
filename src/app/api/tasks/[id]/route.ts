import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { computeProjectHealth } from '@/server/services/project-health';
import { handler, ok, validationError } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

const patchSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(4000).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  deadline: z.string().nullable().optional(),
  assignee: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
});

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const existing = await prisma.task.findFirst({ where: { id, workspaceId: user.workspaceId } });
  if (!existing) throw notFound('Task not found');

  const task = await prisma.task.update({
    where: { id },
    data: {
      ...parsed.data,
      deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : parsed.data.deadline === null ? null : undefined,
      completedAt: parsed.data.status === 'DONE' ? new Date() : parsed.data.status ? null : undefined,
    },
  });

  if (task.projectId) await computeProjectHealth(task.projectId, true);
  return ok({ task });
});

export const DELETE = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const task = await prisma.task.findFirst({ where: { id, workspaceId: user.workspaceId } });
  if (!task) throw notFound('Task not found');
  await prisma.task.delete({ where: { id } });
  if (task.projectId) await computeProjectHealth(task.projectId, true);
  return ok({ deleted: true });
});
