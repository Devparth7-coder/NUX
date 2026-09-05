import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { computeProjectHealth } from '@/server/services/project-health';
import { recordActivity } from '@/server/services/activity';
import { handler, ok, validationError } from '@/lib/api/response';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  objective: z.string().max(500).optional(),
  deadline: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
});

export const GET = handler(async () => {
  const user = await requireUser();
  const projects = await prisma.project.findMany({
    where: { workspaceId: user.workspaceId },
    include: { _count: { select: { tasks: true, documents: true, agentRuns: true } } },
    orderBy: [{ health: 'asc' }, { updatedAt: 'desc' }],
  });
  return ok({ items: projects });
});

export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const slug = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 44);
  const project = await prisma.project.create({
    data: {
      workspaceId: user.workspaceId,
      ownerId: user.id,
      name: parsed.data.name,
      slug: `${slug || 'project'}-${Date.now().toString(36).slice(-4)}`,
      description: parsed.data.description,
      objective: parsed.data.objective,
      deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null,
      priority: parsed.data.priority,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
  });

  await recordActivity({
    workspaceId: user.workspaceId,
    userId: user.id,
    projectId: project.id,
    type: 'PROJECT',
    action: 'Project created',
    summary: project.name,
    entityType: 'PROJECT',
    entityId: project.id,
    severity: 'SUCCESS',
  });

  return ok({ project }, { status: 201 });
});
