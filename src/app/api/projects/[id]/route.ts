import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { recordActivity } from "@/server/services/activity";

const Patch = z.object({
  name: z.string().min(2).max(120).nullish(),
  description: z.string().max(2000).nullish(),
  objective: z.string().max(500).nullish(),
  status: z.enum(["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]).nullish(),
  targetDate: z.string().datetime().nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
});

type Params = { id: string };

export const GET = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const project = await prisma.project.findFirst({
    where: { id, workspaceId: ctx.auth.workspaceId },
    include: {
      tasks: { orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: 100, include: { assignee: { select: { id: true, name: true } } } },
      documents: { orderBy: { createdAt: "desc" }, take: 50 },
      knowledge: { take: 60 },
      milestones: { orderBy: { order: "asc" } },
      agentRuns: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, key: true, name: true, status: true, createdAt: true, latencyMs: true } },
      artifacts: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, title: true, type: true, createdAt: true } },
    },
  });
  if (!project) throw Errors.notFound("Project");

  const now = Date.now();
  const open = project.tasks.filter((t) => t.status !== "DONE");
  const overdue = open.filter((t) => t.dueDate && t.dueDate < new Date());
  const blocked = project.tasks.filter((t) => t.status === "BLOCKED");
  const done = project.tasks.filter((t) => t.status === "DONE").length;

  return ok({
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      objective: project.objective,
      status: project.status,
      health: project.health,
      healthReason: project.healthReason,
      progress: project.progress,
      color: project.color,
      targetDate: project.targetDate,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    intelligence: {
      openTasks: open.length,
      doneTasks: done,
      overdueTasks: overdue.length,
      blockedTasks: blocked.length,
      daysToDeadline: project.targetDate ? Math.ceil((project.targetDate.getTime() - now) / 86_400_000) : null,
      documents: project.documents.length,
      knowledgeItems: project.knowledge.length,
      lastRunAt: project.agentRuns[0]?.createdAt ?? null,
    },
    tasks: project.tasks,
    documents: project.documents,
    knowledge: project.knowledge,
    milestones: project.milestones,
    runs: project.agentRuns,
    artifacts: project.artifacts,
  });
});

export const PATCH = route<typeof Patch, undefined, Params>({ body: Patch }, async (_req, ctx, input) => {
  const { id } = await ctx.params;
  const project = await prisma.project.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!project) throw Errors.notFound("Project");
  const updated = await prisma.project.update({
    where: { id: project.id },
    data: {
      name: input.body.name ?? undefined,
      description: input.body.description ?? undefined,
      objective: input.body.objective ?? undefined,
      status: input.body.status ?? undefined,
      targetDate: input.body.targetDate ? new Date(input.body.targetDate) : input.body.targetDate === null ? null : undefined,
      color: input.body.color ?? undefined,
    },
  });
  await recordActivity({
    workspaceId: ctx.auth.workspaceId,
    userId: ctx.auth.userId,
    projectId: project.id,
    kind: "PROJECT",
    action: "project.update",
    summary: `Updated project “${project.name}”`,
    detail: { changes: input.body },
    entityType: "PROJECT",
    entityId: project.id,
    status: "success",
  });
  return ok({ project: updated });
});

export const DELETE = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const project = await prisma.project.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!project) throw Errors.notFound("Project");
  await prisma.project.delete({ where: { id: project.id } });
  return ok({ deleted: true });
});
