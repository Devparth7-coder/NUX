import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { validateGraph, workflowGraphSchema } from '@/lib/orchestration/workflow-engine';
import { handler, ok, validationError } from '@/lib/api/response';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  projectId: z.string().optional().nullable(),
  trigger: z.string().default('MANUAL'),
  graph: workflowGraphSchema,
});

export const GET = handler(async () => {
  const user = await requireUser();
  const workflows = await prisma.workflow.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });
  return ok({ items: workflows });
});

export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const validation = validateGraph(parsed.data.graph);
  const workflow = await prisma.workflow.create({
    data: {
      workspaceId: user.workspaceId,
      userId: user.id,
      projectId: parsed.data.projectId ?? null,
      name: parsed.data.name,
      description: parsed.data.description,
      trigger: parsed.data.trigger,
      graph: JSON.stringify(parsed.data.graph),
      status: validation.valid ? 'ACTIVE' : 'DRAFT',
    },
  });

  return ok({ workflow, validation }, { status: 201 });
});
