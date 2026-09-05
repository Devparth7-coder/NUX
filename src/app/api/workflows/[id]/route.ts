import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { validateGraph, workflowGraphSchema } from '@/lib/orchestration/workflow-engine';
import { handler, ok, validationError } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(1000).optional(),
  graph: workflowGraphSchema.optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  trigger: z.string().optional(),
});

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const workflow = await prisma.workflow.findFirst({
    where: { id, userId: user.id },
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
  if (!workflow) throw notFound('Workflow not found');
  return ok({ workflow });
});

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const workflow = await prisma.workflow.findFirst({ where: { id, userId: user.id } });
  if (!workflow) throw notFound('Workflow not found');

  // Version bump on graph change.
  const graphChanged = parsed.data.graph && JSON.stringify(parsed.data.graph) !== workflow.graph;
  const validation = parsed.data.graph ? validateGraph(parsed.data.graph) : null;

  const updated = await prisma.workflow.update({
    where: { id },
    data: {
      ...parsed.data,
      graph: parsed.data.graph ? JSON.stringify(parsed.data.graph) : undefined,
      version: graphChanged ? { increment: 1 } : undefined,
      status: validation && !validation.valid ? 'DRAFT' : parsed.data.status,
    },
  });

  return ok({ workflow: updated, validation });
});

export const DELETE = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await prisma.workflow.deleteMany({ where: { id, userId: user.id } });
  return ok({ deleted: true });
});
