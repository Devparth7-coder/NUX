import { z } from "zod";
import { prisma } from "@/lib/db";
import { registerTool } from "@/lib/tools/registry";

/**
 * Real analytics computed from workspace rows — no synthetic numbers.
 */
registerTool({
  key: "data.analyze",
  name: "Analyze workspace data",
  description: "Compute delivery metrics: completion, overdue load, priority mix, throughput and deadline pressure.",
  category: "DATA_ANALYSIS",
  permissionLevel: "READ",
  inputSchema: z.object({
    projectId: z.string().nullish(),
    windowDays: z.number().int().min(1).max(365).default(30),
  }),
  summarize: (i) => `Analyze workspace data over ${i.windowDays ?? 30} days`,
  handler: async (input, ctx) => {
    const projectFilter = input.projectId ? { projectId: input.projectId } : {};
    const since = new Date(Date.now() - (input.windowDays ?? 30) * 86_400_000);

    const [tasks, byStatus, completedRecent, overdue, agents, tools] = await Promise.all([
      prisma.task.findMany({ where: { workspaceId: ctx.workspaceId, ...projectFilter }, select: { status: true, priority: true, dueDate: true, completedAt: true } }),
      prisma.task.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId, ...projectFilter }, _count: { _all: true } }),
      prisma.task.count({ where: { workspaceId: ctx.workspaceId, ...projectFilter, completedAt: { gte: since } } }),
      prisma.task.count({ where: { workspaceId: ctx.workspaceId, ...projectFilter, dueDate: { lt: new Date() }, status: { not: "DONE" } } }),
      prisma.agentRun.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } }, _count: { _all: true }, _avg: { latencyMs: true } }),
      prisma.toolExecution.groupBy({ by: ["status"], where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } }, _count: { _all: true }, _avg: { durationMs: true } }),
    ]);

    const total = tasks.length || 1;
    const done = tasks.filter((t) => t.status === "DONE").length;
    const priorityMix = ["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => ({
      priority: p,
      count: tasks.filter((t) => t.priority === p).length,
    }));

    return {
      window: input.windowDays ?? 30,
      tasks: {
        total: tasks.length,
        done,
        completionRate: Number((done / total).toFixed(3)),
        overdue,
        completedInWindow: completedRecent,
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
        priorityMix,
      },
      agents: {
        byStatus: agents.map((a) => ({ status: a.status, count: a._count._all, avgLatencyMs: Math.round(a._avg.latencyMs ?? 0) })),
      },
      tools: {
        byStatus: tools.map((t) => ({ status: t.status, count: t._count._all, avgDurationMs: Math.round(t._avg.durationMs ?? 0) })),
      },
    };
  },
});
