import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { enqueue, driverName } from '@/lib/jobs';
import { handler, ok, validationError } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 120;

const schema = z.object({ input: z.record(z.unknown()).default({}), projectId: z.string().optional().nullable() });

/**
 * Run a workflow through the job driver.
 * inline → executed immediately and the outcome is returned.
 * queue  → persisted as QUEUED and picked up by the worker (POST /api/jobs).
 */
export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const workflow = await prisma.workflow.findFirst({ where: { id, userId: user.id } });
  if (!workflow) throw notFound('Workflow not found');

  const job = await enqueue(
    'workflow.run',
    {
      workflowId: workflow.id,
      userId: user.id,
      workspaceId: user.workspaceId,
      projectId: parsed.data.projectId ?? workflow.projectId,
      input: parsed.data.input,
    },
    { userId: user.id, workspaceId: user.workspaceId, projectId: parsed.data.projectId ?? workflow.projectId },
  );

  if (driverName() === 'inline') {
    return ok({ ...((job.result as object) ?? {}), jobId: job.id }, { status: 202 });
  }

  return ok({ jobId: job.id, type: job.type, status: 'QUEUED' }, { status: 202 });
});
