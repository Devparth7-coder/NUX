import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { computeProjectHealth } from '@/server/services/project-health';
import { handler, ok, validationError } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(4000).optional(),
  objective: z.string().max(1000).optional(),
  summary: z.string().max(4000).optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  deadline: z.string().nullable().optional(),
});

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;

  const project = await prisma.project.findFirst({
    where: { id, workspaceId: user.workspaceId },
    include: {
      tasks: { orderBy: [{ status: 'asc' }, { deadline: 'asc' }] },
      documents: { orderBy: { updatedAt: 'desc' } },
      knowledge: { take: 40 },
      milestones: { orderBy: { order: 'asc' } },
      artifacts: { orderBy: { createdAt: 'desc' }, take: 20 },
      agentRuns: { orderBy: { createdAt: 'desc' }, take: 10, include: { agent: { select: { name: true, key: true } } } },
      activities: { orderBy: { createdAt: 'desc' }, take: 25 },
      members: true,
    },
  });
  if (!project) throw notFound('Project not found');

  const health = await computeProjectHealth(project.id, true);
  return ok({ project, health });
});

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const project = await prisma.project.update({
    where: { id },
    data: { ...parsed.data, deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : parsed.data.deadline === null ? null : undefined },
  });
  return ok({ project });
});

export const DELETE = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await prisma.project.delete({ where: { id, workspaceId: user.workspaceId } });
  return ok({ deleted: true });
});
