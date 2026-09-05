import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { recordActivity } from "@/server/services/activity";

type Params = { id: string };

const Patch = z.object({
  title: z.string().min(3).max(160).nullish(),
  description: z.string().max(4000).nullish(),
  status: z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]).nullish(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).nullish(),
  dueDate: z.string().datetime().nullish(),
  assigneeId: z.string().nullish(),
  blockedReason: z.string().nullish(),
  projectId: z.string().nullish(),
});

export const PATCH = route<typeof Patch, undefined, Params>({ body: Patch }, async (_req, ctx, input) => {
  const { id } = await ctx.params;
  const task = await prisma.task.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!task) throw Errors.notFound("Task");
  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      title: input.body.title ?? undefined,
      description: input.body.description ?? undefined,
      status: input.body.status ?? undefined,
      priority: input.body.priority ?? undefined,
      dueDate: input.body.dueDate ? new Date(input.body.dueDate) : input.body.dueDate === null ? null : undefined,
      assigneeId: input.body.assigneeId === null ? null : (input.body.assigneeId ?? undefined),
      blockedReason: input.body.blockedReason ?? undefined,
      projectId: input.body.projectId ?? undefined,
      completedAt: input.body.status === "DONE" ? new Date() : input.body.status ? null : undefined,
    },
  });
  await recordActivity({
    workspaceId: ctx.auth.workspaceId,
    userId: ctx.auth.userId,
    projectId: task.projectId,
    kind: "TASK",
    action: "task.update",
    summary: `Updated task “${task.title}”`,
    detail: { changes: input.body },
    entityType: "TASK",
    entityId: task.id,
    status: "success",
  });
  return ok({ task: updated });
});

export const DELETE = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const task = await prisma.task.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!task) throw Errors.notFound("Task");
  await prisma.task.delete({ where: { id: task.id } });
  return ok({ deleted: true });
});
