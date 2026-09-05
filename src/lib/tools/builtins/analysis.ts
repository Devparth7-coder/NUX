import { z } from 'zod';
import { prisma } from '../../db';
import { computeProjectHealth } from '../../../server/services/project-health';
import type { AnyTool } from '../types';

export const taskMetrics: AnyTool = {
  key: 'data.task_metrics',
  name: 'Task metrics',
  description: 'Compute real counts of tasks by status, overdue tasks, blocked tasks and dependency conflicts.',
  category: 'DATA_ANALYSIS',
  permission: 'READ',
  timeoutMs: 15000,
  schema: z.object({ projectId: z.string().optional() }),
  async handler(args, ctx) {
    const where = {
      workspaceId: ctx.workspaceId,
      ...(args.projectId ? { projectId: args.projectId } : {}),
    } as const;
    const [byStatus, overdue, withDeadline, total] = await Promise.all([
      prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.task.count({ where: { ...where, deadline: { lt: new Date() }, status: { not: 'DONE' } } }),
      prisma.task.count({ where: { ...where, deadline: { not: null } } }),
      prisma.task.count({ where }),
    ]);

    const tasks = await prisma.task.findMany({
      where,
      select: { id: true, title: true, status: true, deadline: true, dependents: { select: { dependsOnId: true, dependsOn: { select: { status: true } } } } },
      take: 300,
    });

    const dependencyConflicts = tasks
      .filter((t) => t.dependents.some((d) => d.dependsOn.status !== 'DONE') && t.status === 'DONE')
      .map((t) => t.title);

    return {
      total,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      overdue,
      withDeadline,
      dependencyConflicts,
      completionRate: total ? Number((((byStatus.find((s) => s.status === 'DONE')?._count._all ?? 0) / total) * 100).toFixed(1)) : 0,
    };
  },
};

export const projectHealth: AnyTool = {
  key: 'data.project_health',
  name: 'Project health',
  description: 'Recompute and return project health, blockers, risks and deadline pressure.',
  category: 'DATA_ANALYSIS',
  permission: 'READ',
  timeoutMs: 20000,
  schema: z.object({ projectId: z.string().optional() }),
  async handler(args, ctx) {
    const projectId = args.projectId ?? ctx.projectId;
    if (!projectId) return { error: 'No project in scope.' };
    return computeProjectHealth(projectId, true);
  },
};

export const analysis: AnyTool[] = [taskMetrics, projectHealth];
