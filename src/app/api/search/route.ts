import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { hybridSearch } from "@/lib/retrieval/hybrid";

const Query = z.object({ q: z.string().min(2).max(200), limit: z.coerce.number().int().min(1).max(30).default(12) });

/** Global search: semantic + lexical across every workspace surface. */
export const GET = route<undefined, typeof Query>({ query: Query, rateLimit: { limit: 60, windowMs: 60_000 } }, async (_req, ctx, input) => {
  const { q, limit } = input.query!;
  const workspaceId = ctx.auth.workspaceId;

  const [semantic, projects, tasks, conversations, agents, activity] = await Promise.all([
    hybridSearch({ workspaceId, query: q, limit }),
    prisma.project.findMany({
      where: { workspaceId, OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { objective: { contains: q, mode: "insensitive" } }] },
      take: 6,
      select: { id: true, name: true, health: true, progress: true, updatedAt: true },
    }),
    prisma.task.findMany({
      where: { workspaceId, OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
      take: 8,
      select: { id: true, title: true, status: true, priority: true, dueDate: true, projectId: true },
    }),
    prisma.conversation.findMany({
      where: { userId: ctx.auth.userId, OR: [{ title: { contains: q, mode: "insensitive" } }, { messages: { some: { content: { contains: q, mode: "insensitive" } } } }] },
      take: 5,
      select: { id: true, title: true, updatedAt: true },
    }),
    prisma.agent.findMany({ where: { workspaceId, OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] }, take: 5, select: { id: true, key: true, name: true, description: true } }),
    prisma.activity.findMany({ where: { workspaceId, OR: [{ summary: { contains: q, mode: "insensitive" } }, { action: { contains: q, mode: "insensitive" } }] }, take: 6, orderBy: { createdAt: "desc" }, select: { id: true, summary: true, kind: true, createdAt: true } }),
  ]);

  return ok({
    query: q,
    semantic,
    groups: {
      projects,
      tasks,
      conversations,
      agents,
      activity,
    },
    total: semantic.length + projects.length + tasks.length + conversations.length + agents.length + activity.length,
  });
});
