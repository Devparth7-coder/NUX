import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { registerTool } from "@/lib/tools/registry";
import { recordActivity } from "@/server/services/activity";

const taskStatus = z.enum(["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]);
const taskPriority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

registerTool({
  key: "tasks.list",
  name: "List tasks",
  description: "Query tasks with status, project and deadline filters.",
  category: "TASKS",
  permissionLevel: "READ",
  inputSchema: z.object({
    projectId: z.string().nullish(),
    status: taskStatus.nullish(),
    overdueOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  summarize: (i) => `List tasks${i.overdueOnly ? " that are overdue" : ""}`,
  handler: async (input, ctx) =>
    prisma.task.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.overdueOnly ? { dueDate: { lt: new Date() }, status: { not: "DONE" } } : {}),
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: input.limit ?? 30,
      include: { project: { select: { name: true } } },
    }),
});

registerTool({
  key: "tasks.create",
  name: "Create tasks",
  description: "Create one or more tasks in a project. Writes real rows and records activity.",
  category: "TASKS",
  permissionLevel: "WRITE",
  inputSchema: z.object({
    projectId: z.string().nullish(),
    tasks: z
      .array(
        z.object({
          title: z.string().min(3).max(160),
          description: z.string().max(2000).nullish(),
          priority: taskPriority.default("MEDIUM"),
          dueDate: z.string().datetime().nullish(),
          assigneeId: z.string().nullish(),
        }),
      )
      .min(1)
      .max(25),
  }),
  summarize: (i) =>
    `Create ${i.tasks.length} task(s): ${i.tasks
      .slice(0, 3)
      .map((t) => `“${t.title}”`)
      .join(", ")}${i.tasks.length > 3 ? ` +${i.tasks.length - 3} more` : ""}`,
  affectedData: (i) => ({
    projectId: i.projectId ?? null,
    tasks: i.tasks.map((t) => ({ title: t.title, priority: t.priority, dueDate: t.dueDate ?? null })),
  }),
  handler: async (input, ctx) => {
    const created = await prisma.$transaction(
      input.tasks.map((t) =>
        prisma.task.create({
          data: {
            workspaceId: ctx.workspaceId,
            projectId: input.projectId ?? null,
            title: t.title,
            description: t.description ?? null,
            priority: t.priority,
            dueDate: t.dueDate ? new Date(t.dueDate) : null,
            assigneeId: t.assigneeId ?? null,
            source: "AGENT",
            createdByAgent: "execution",
            createdByRunId: ctx.runId ?? null,
          },
        }),
      ),
    );
    await recordActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      projectId: input.projectId ?? null,
      kind: "TASK",
      action: "tasks.create",
      summary: `Created ${created.length} task(s)`,
      detail: { titles: created.map((t) => t.title), runId: ctx.runId ?? null } as Prisma.InputJsonValue,
      entityType: "TASK",
      status: "success",
    });
    return {
      created: created.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority, status: t.status })),
    };
  },
});

registerTool({
  key: "tasks.update",
  name: "Update task",
  description: "Update status, priority, due date or blocker reason on a task.",
  category: "TASKS",
  permissionLevel: "WRITE",
  inputSchema: z.object({
    taskId: z.string(),
    status: taskStatus.nullish(),
    priority: taskPriority.nullish(),
    dueDate: z.string().datetime().nullish(),
    blockedReason: z.string().nullish(),
    description: z.string().nullish(),
  }),
  summarize: (i) => `Update task${i.status ? ` → ${i.status}` : ""}${i.priority ? ` (${i.priority})` : ""}`,
  affectedData: (i) => ({ taskId: i.taskId, status: i.status ?? null, priority: i.priority ?? null, dueDate: i.dueDate ?? null }),
  handler: async (input, ctx) => {
    const task = await prisma.task.findFirst({ where: { id: input.taskId, workspaceId: ctx.workspaceId } });
    if (!task) throw new Error("Task not found");
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: input.status ?? undefined,
        priority: input.priority ?? undefined,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        blockedReason: input.blockedReason ?? undefined,
        description: input.description ?? undefined,
        completedAt: input.status === "DONE" ? new Date() : input.status ? null : undefined,
      },
    });
    await recordActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      projectId: task.projectId,
      kind: "TASK",
      action: "tasks.update",
      summary: `Updated task “${task.title}”`,
      detail: { changes: input } as Prisma.InputJsonValue,
      entityType: "TASK",
      entityId: task.id,
      status: "success",
    });
    return { id: updated.id, title: updated.title, status: updated.status, priority: updated.priority, dueDate: updated.dueDate };
  },
});

registerTool({
  key: "tasks.schedule",
  name: "Schedule tasks",
  description: "Set due dates (and optionally priority) on a batch of existing tasks — e.g. spreading them across a deadline window.",
  category: "TASKS",
  permissionLevel: "WRITE",
  inputSchema: z.object({
    entries: z
      .array(
        z.object({
          taskId: z.string(),
          dueDate: z.string().datetime().nullish(),
          priority: taskPriority.nullish(),
        }),
      )
      .min(1)
      .max(25),
  }),
  summarize: (i) => `Schedule ${i.entries.length} task(s) against the deadline window`,
  affectedData: (i) => ({ entries: i.entries }),
  handler: async (input, ctx) => {
    const updated = [];
    for (const entry of input.entries) {
      const task = await prisma.task.findFirst({ where: { id: entry.taskId, workspaceId: ctx.workspaceId } });
      if (!task) continue;
      const row = await prisma.task.update({
        where: { id: task.id },
        data: {
          dueDate: entry.dueDate ? new Date(entry.dueDate) : undefined,
          priority: entry.priority ?? undefined,
        },
      });
      updated.push({ id: row.id, title: row.title, dueDate: row.dueDate, priority: row.priority });
    }
    await recordActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      kind: "TASK",
      action: "tasks.schedule",
      summary: `Scheduled ${updated.length} task(s)`,
      detail: { entries: updated } as Prisma.InputJsonValue,
      entityType: "TASK",
      status: "success",
    });
    return { updated, count: updated.length };
  },
});
