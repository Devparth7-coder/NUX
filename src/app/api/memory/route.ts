import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { saveMemory, searchMemory, runMemoryLifecycle } from "@/lib/memory/manager";

export const GET = route({ auth: true }, async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q");
  const type = sp.get("type");
  const scope = sp.get("scope");
  const includeDisabled = sp.get("includeDisabled") === "true";

  const memories = q && q.length > 2
    ? await searchMemory(ctx.auth.workspaceId, q, 30)
    : await prisma.memory.findMany({
        where: {
          workspaceId: ctx.auth.workspaceId,
          ...(type ? { type: type as never } : {}),
          ...(scope ? { scope: scope as never } : {}),
          ...(includeDisabled ? {} : { enabled: true }),
        },
        orderBy: [{ pinned: "desc" }, { importance: "desc" }, { updatedAt: "desc" }],
        take: 100,
        include: { project: { select: { id: true, name: true } } },
      });

  const counts = await prisma.memory.groupBy({
    by: ["type"],
    where: { workspaceId: ctx.auth.workspaceId, enabled: true },
    _count: { _all: true },
  });

  return ok({
    memories,
    counts: counts.map((c) => ({ type: c.type, count: c._count._all })),
  });
});

const Create = z.object({
  content: z.string().min(8).max(2000),
  type: z.enum(["SHORT_TERM", "PROJECT", "LONG_TERM", "EXPLICIT"]).default("EXPLICIT"),
  scope: z.enum(["SESSION", "PROJECT", "USER", "WORKSPACE"]).default("USER"),
  importance: z.number().min(0).max(1).default(0.7),
  projectId: z.string().nullish(),
  tags: z.array(z.string()).default([]),
});

export const POST = route({ body: Create }, async (_req, ctx, input) => {
  const id = await saveMemory({
    workspaceId: ctx.auth.workspaceId,
    userId: ctx.auth.userId,
    projectId: input.body.projectId ?? null,
    content: input.body.content,
    type: input.body.type,
    scope: input.body.scope,
    importance: input.body.importance,
    source: "user",
    tags: input.body.tags,
  });
  return ok({ id }, { status: 201 });
});

export const DELETE = route({ auth: true }, async (_req, ctx) => {
  const result = await runMemoryLifecycle(ctx.auth.workspaceId);
  return ok(result);
});
