import { z } from "zod";
import { prisma } from "@/lib/db";
import { registerTool } from "@/lib/tools/registry";
import { recordActivity } from "@/server/services/activity";

registerTool({
  key: "projects.list",
  name: "List projects",
  description: "List projects with health and progress signals.",
  category: "PROJECTS",
  permissionLevel: "READ",
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  summarize: () => "List workspace projects",
  handler: async (input, ctx) =>
    prisma.project.findMany({
      where: { workspaceId: ctx.workspaceId },
      orderBy: { updatedAt: "desc" },
      take: input.limit ?? 20,
      select: {
        id: true,
        name: true,
        status: true,
        health: true,
        progress: true,
        objective: true,
        targetDate: true,
        _count: { select: { tasks: true, documents: true } },
      },
    }),
});

registerTool({
  key: "projects.read",
  name: "Read project",
  description: "Read a project with its open tasks, documents and recent runs.",
  category: "PROJECTS",
  permissionLevel: "READ",
  inputSchema: z.object({ projectId: z.string() }),
  summarize: (i) => `Read project ${i.projectId}`,
  handler: async (input, ctx) => {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, workspaceId: ctx.workspaceId } });
    if (!project) throw new Error("Project not found");
    const [tasks, documents, runs, knowledge] = await Promise.all([
      prisma.task.findMany({ where: { projectId: project.id }, orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: 30 }),
      prisma.document.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, status: true, chunkCount: true },
      }),
      prisma.agentRun.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, key: true, name: true, status: true, createdAt: true },
      }),
      prisma.knowledgeItem.findMany({
        where: { projectId: project.id },
        take: 12,
        select: { id: true, label: true, kind: true, content: true },
      }),
    ]);
    return { project, tasks, documents, runs, knowledge };
  },
});

registerTool({
  key: "projects.update",
  name: "Update project",
  description: "Update a project's objective, target date, progress or health.",
  category: "PROJECTS",
  permissionLevel: "WRITE",
  inputSchema: z.object({
    projectId: z.string(),
    objective: z.string().nullish(),
    targetDate: z.string().datetime().nullish(),
    progress: z.number().int().min(0).max(100).nullish(),
    health: z.enum(["HEALTHY", "AT_RISK", "BLOCKED", "COMPLETED"]).nullish(),
    healthReason: z.string().nullish(),
  }),
  summarize: (i) =>
    `Update project: ${[
      i.objective ? "objective" : null,
      i.targetDate ? "target date" : null,
      i.progress !== null && i.progress !== undefined ? `progress → ${i.progress}%` : null,
      i.health ? `health → ${i.health}` : null,
    ]
      .filter(Boolean)
      .join(", ")}`,
  affectedData: (i) => ({
    projectId: i.projectId,
    objective: i.objective ?? null,
    targetDate: i.targetDate ?? null,
    progress: i.progress ?? null,
    health: i.health ?? null,
  }),
  handler: async (input, ctx) => {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, workspaceId: ctx.workspaceId } });
    if (!project) throw new Error("Project not found");
    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        objective: input.objective ?? undefined,
        targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
        progress: input.progress ?? undefined,
        health: input.health ?? undefined,
        healthReason: input.healthReason ?? undefined,
      },
    });
    await recordActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      projectId: project.id,
      kind: "PROJECT",
      action: "projects.update",
      summary: `Updated project “${project.name}”`,
      detail: { changes: input },
      entityType: "PROJECT",
      entityId: project.id,
      status: "success",
    });
    return {
      id: updated.id,
      name: updated.name,
      objective: updated.objective,
      targetDate: updated.targetDate,
      progress: updated.progress,
      health: updated.health,
    };
  },
});
