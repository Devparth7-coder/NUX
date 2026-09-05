import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { computeProjectHealth } from '@/server/services/project-health';
import { handler, ok, validationError } from '@/lib/api/response';

export const runtime = 'nodejs';

const createSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']).default('TODO'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  projectId: z.string().optional().nullable(),
  deadline: z.string().optional().nullable(),
  assignee: z.string().optional().nullable(),
});

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const status = req.nextUrl.searchParams.get('status');
  const projectId = req.nextUrl.searchParams.get('projectId');
  const tasks = await prisma.task.findMany({
    where: {
      workspaceId: user.workspaceId,
      ...(status ? { status } : {}),
      ...(projectId ? { projectId } : {}),
    },
    include: {
      project: { select: { id: true, name: true } },
      dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
    },
    orderBy: [{ status: 'asc' }, { deadline: 'asc' }, { priority: 'desc' }],
    take: 300,
  });
  return ok({ items: tasks });
});

export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const task = await prisma.task.create({
    data: {
      workspaceId: user.workspaceId,
      createdById: user.id,
      projectId: parsed.data.projectId ?? null,
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      status: parsed.data.status,
      priority: parsed.data.priority,
      deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null,
      assignee: parsed.data.assignee ?? null,
      completedAt: parsed.data.status === 'DONE' ? new Date() : null,
      source: 'USER',
    },
  });

  if (task.projectId) await computeProjectHealth(task.projectId, true);
  return ok({ task }, { status: 201 });
});
