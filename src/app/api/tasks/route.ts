import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok, parsePage } from "@/lib/api";
import { recordActivity } from "@/server/services/activity";

const Create = z.object({
  title: z.string().min(3).max(160),
  description: z.string().max(4000).nullish(),
  projectId: z.string().nullish(),
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.string().datetime().nullish(),
  assigneeId: z.string().nullish(),
  dependsOn: z.array(z.string()).default([]),
});

export const GET = route({ auth: true }, async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const { skip, take, page, pageSize } = parsePage(sp, 50);
  const projectId = sp.get("projectId");
  const status = sp.get("status");
  const overdue = sp.get("overdue") === "true";

  const where = {
    workspaceId: ctx.auth.workspaceId,
    ...(projectId ? { projectId } : {}),
    ...(status ? { status: status as never } : {}),
    ...(overdue ? { dueDate: { lt: new Date() }, status: { not: "DONE" as never } } : {}),
  };

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [{ status: "asc" }, { priority: "desc" }, { dueDate: "asc" }],
      skip,
      take,
      include: { project: { select: { id: true, name: true, color: true } }, assignee: { select: { id: true, name: true } }, dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } } },
    }),
    prisma.task.count({ where }),
  ]);

  const now = Date.now();
  return ok({
    page,
    pageSize,
    total,
    summary: {
      total,
      done: tasks.filter((t) => t.status === "DONE").length,
      blocked: tasks.filter((t) => t.status === "BLOCKED").length,
      overdue: tasks.filter((t) => t.dueDate && t.dueDate.getTime() < now && t.status !== "DONE").length,
    },
    tasks,
  });
});

export const POST = route({ body: Create }, async (_req, ctx, input) => {
  const task = await prisma.task.create({
    data: {
      workspaceId: ctx.auth.workspaceId,
      projectId: input.body.projectId ?? null,
      title: input.body.title,
      description: input.body.description ?? null,
      status: input.body.status,
      priority: input.body.priority,
      dueDate: input.body.dueDate ? new Date(input.body.dueDate) : null,
      assigneeId: input.body.assigneeId ?? null,
      source: "USER",
      dependencies: input.body.dependsOn.length
        ? { create: input.body.dependsOn.map((id) => ({ dependsOnId: id })) }
        : undefined,
    },
  });
  await recordActivity({
    workspaceId: ctx.auth.workspaceId,
    userId: ctx.auth.userId,
    projectId: task.projectId,
    kind: "TASK",
    action: "task.create",
    summary: `Created task “${task.title}”`,
    entityType: "TASK",
    entityId: task.id,
    status: "success",
  });
  return ok({ task }, { status: 201 });
});
