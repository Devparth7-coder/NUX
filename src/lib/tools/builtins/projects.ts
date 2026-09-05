import { z } from 'zod';
import { prisma } from '../../db';
import { computeProjectHealth } from '../../../server/services/project-health';
import type { AnyTool } from '../types';

export const projectList: AnyTool = {
  key: 'projects.list',
  name: 'List projects',
  description: 'List workspace projects with health and progress.',
  category: 'PROJECTS',
  permission: 'READ',
  timeoutMs: 10000,
  schema: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
  async handler(args, ctx) {
    const projects = await prisma.project.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { updatedAt: 'desc' },
      take: args.limit,
      select: { id: true, name: true, slug: true, status: true, health: true, progress: true, deadline: true, objective: true },
    });
    return { count: projects.length, projects };
  },
};

export const projectRead: AnyTool = {
  key: 'projects.read',
  name: 'Read project',
  description: 'Read a project with its tasks, documents and computed health.',
  category: 'PROJECTS',
  permission: 'READ',
  timeoutMs: 15000,
  schema: z.object({ projectId: z.string().optional(), name: z.string().optional() }),
  async handler(args, ctx) {
    const project = await prisma.project.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        ...(args.projectId ? { id: args.projectId } : {}),
        ...(!args.projectId && args.name ? { name: { contains: args.name } } : {}),
      },
      include: {
        tasks: { select: { id: true, title: true, status: true, priority: true, deadline: true }, take: 100 },
        documents: { select: { id: true, title: true, status: true }, take: 50 },
      },
    });
    if (!project) return { error: 'Project not found.' };
    const health = await computeProjectHealth(project.id);
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      objective: project.objective,
      deadline: project.deadline,
      progress: project.progress,
      tasks: project.tasks,
      documents: project.documents,
      health,
    };
  },
};

export const projectUpdate: AnyTool = {
  key: 'projects.update',
  name: 'Update project',
  description: 'Update project fields. Real write; recalculates health.',
  category: 'PROJECTS',
  permission: 'WRITE',
  timeoutMs: 20000,
  schema: z.object({
    projectId: z.string(),
    objective: z.string().optional(),
    status: z.string().optional(),
    summary: z.string().optional(),
    deadline: z.string().optional(),
    progress: z.number().int().min(0).max(100).optional(),
  }),
  async handler(args, ctx) {
    const { projectId, ...rest } = args;
    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...rest,
        deadline: rest.deadline ? new Date(rest.deadline) : undefined,
      },
    });
    await computeProjectHealth(project.id, true);
    return { updated: true, id: project.id, name: project.name, objective: project.objective, status: project.status };
  },
};

export const projectCreate: AnyTool = {
  key: 'projects.create',
  name: 'Create project',
  description: 'Create a new project in the workspace.',
  category: 'PROJECTS',
  permission: 'WRITE',
  timeoutMs: 20000,
  schema: z.object({
    name: z.string().min(2),
    description: z.string().default(''),
    objective: z.string().optional(),
    deadline: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  }),
  async handler(args, ctx) {
    const slug = args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48);
    const project = await prisma.project.create({
      data: {
        workspaceId: ctx.workspaceId,
        ownerId: ctx.userId,
        name: args.name,
        slug: `${slug}-${Date.now().toString(36).slice(-4)}`,
        description: args.description,
        objective: args.objective ?? null,
        deadline: args.deadline ? new Date(args.deadline) : null,
        priority: args.priority,
      },
    });
    return { created: true, id: project.id, name: project.name, slug: project.slug };
  },
};

export const projects: AnyTool[] = [projectList, projectRead, projectUpdate, projectCreate];
