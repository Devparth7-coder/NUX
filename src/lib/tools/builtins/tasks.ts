import { z } from 'zod';
import { prisma } from '../../db';
import { computeProjectHealth } from '../../../server/services/project-health';
import type { AnyTool } from '../types';

const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const statusEnum = z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']);

export const taskCreate: AnyTool = {
  key: 'tasks.create',
  name: 'Create task',
  description: 'Create a real task in the workspace, optionally inside a project.',
  category: 'TASKS',
  permission: 'WRITE',
  timeoutMs: 20000,
  schema: z.object({
    title: z.string().min(2),
    description: z.string().default(''),
    priority: priorityEnum.default('MEDIUM'),
    status: statusEnum.default('TODO'),
    projectId: z.string().optional(),
    deadline: z.string().optional(),
    assignee: z.string().optional(),
    dependsOnTitles: z.array(z.string()).default([]),
  }),
  async handler(args, ctx) {
    const projectId = args.projectId ?? ctx.projectId ?? null;
    const task = await prisma.task.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
        createdById: ctx.userId,
        createdByAgent: ctx.agentKey ?? null,
        title: args.title,
        description: args.description,
        priority: args.priority,
        status: args.status,
        deadline: args.deadline ? new Date(args.deadline) : null,
        assignee: args.assignee ?? null,
        source: 'AGENT',
        sourceRunId: ctx.runId ?? null,
      },
    });

    let linked = 0;
    if (args.dependsOnTitles.length && projectId) {
      for (const title of args.dependsOnTitles) {
        const dep = await prisma.task.findFirst({
          where: { workspaceId: ctx.workspaceId, title: { contains: title } },
        });
        if (dep && dep.id !== task.id) {
          await prisma.taskDependency.upsert({
            where: { taskId_dependsOnId: { taskId: task.id, dependsOnId: dep.id } },
            create: { taskId: task.id, dependsOnId: dep.id, type: 'BLOCKS' },
            update: {},
          });
          linked++;
        }
      }
    }

    if (projectId) await computeProjectHealth(projectId, true);
    return { created: true, id: task.id, title: task.title, priority: task.priority, dependenciesLinked: linked };
  },
};

export const taskUpdate: AnyTool = {
  key: 'tasks.update',
  name: 'Update task',
  description: 'Update status, priority, deadline or assignment of an existing task.',
  category: 'TASKS',
  permission: 'WRITE',
  timeoutMs: 20000,
  schema: z.object({
    taskId: z.string().optional(),
    title: z.string().optional(),
    status: statusEnum.optional(),
    priority: priorityEnum.optional(),
    deadline: z.string().optional(),
    assignee: z.string().optional(),
    description: z.string().optional(),
  }),
  async handler(args, ctx) {
    const task = await prisma.task.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        ...(args.taskId ? { id: args.taskId } : {}),
        ...(!args.taskId && args.title ? { title: { contains: args.title } } : {}),
      },
    });
    if (!task) return { updated: false, reason: 'Task not found. Nothing was changed.' };
    const { taskId, title, deadline, ...rest } = args;
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        ...rest,
        deadline: deadline ? new Date(deadline) : undefined,
        completedAt: args.status === 'DONE' ? new Date() : args.status ? null : undefined,
      },
    });
    if (updated.projectId) await computeProjectHealth(updated.projectId, true);
    return { updated: true, id: updated.id, title: updated.title, status: updated.status, priority: updated.priority };
  },
};

export const taskList: AnyTool = {
  key: 'tasks.list',
  name: 'List tasks',
  description: 'List tasks, optionally filtered by status or project.',
  category: 'TASKS',
  permission: 'READ',
  timeoutMs: 10000,
  schema: z.object({
    status: statusEnum.optional(),
    projectId: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async handler(args, ctx) {
    const tasks = await prisma.task.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(args.status ? { status: args.status } : {}),
        ...(args.projectId ? { projectId: args.projectId } : {}),
      },
      orderBy: [{ deadline: 'asc' }, { priority: 'desc' }],
      take: args.limit,
      select: { id: true, title: true, status: true, priority: true, deadline: true, projectId: true, source: true },
    });
    const overdue = tasks.filter((t) => t.deadline && t.deadline < new Date() && t.status !== 'DONE').length;
    return { count: tasks.length, overdue, tasks };
  },
};

export const taskDelete: AnyTool = {
  key: 'tasks.delete',
  name: 'Delete task',
  description: 'Permanently delete a task.',
  category: 'TASKS',
  permission: 'HIGH_IMPACT',
  timeoutMs: 15000,
  schema: z.object({ taskId: z.string() }),
  async handler(args, ctx) {
    const task = await prisma.task.findFirst({ where: { id: args.taskId, workspaceId: ctx.workspaceId } });
    if (!task) return { deleted: false, reason: 'Task not found.' };
    await prisma.task.delete({ where: { id: task.id } });
    if (task.projectId) await computeProjectHealth(task.projectId, true);
    return { deleted: true, id: task.id, title: task.title };
  },
};

export const tasks: AnyTool[] = [taskCreate, taskUpdate, taskList, taskDelete];
