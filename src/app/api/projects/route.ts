import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok, parsePage } from "@/lib/api";
import { slugify } from "@/lib/id";
import { recordActivity } from "@/server/services/activity";

const Create = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).nullish(),
  objective: z.string().max(500).nullish(),
  targetDate: z.string().datetime().nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#3B82F6"),
});

export const GET = route({ auth: true }, async (req, ctx) => {
  const { skip, take, page, pageSize } = parsePage(new URL(req.url).searchParams);
  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where: { workspaceId: ctx.auth.workspaceId },
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      include: {
        _count: { select: { tasks: true, documents: true } },
        tasks: { select: { status: true } },
      },
    }),
    prisma.project.count({ where: { workspaceId: ctx.auth.workspaceId } }),
  ]);
  return ok({
    page,
    pageSize,
    total,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      objective: p.objective,
      status: p.status,
      health: p.health,
      healthReason: p.healthReason,
      progress: p.progress,
      color: p.color,
      targetDate: p.targetDate,
      updatedAt: p.updatedAt,
      counts: { tasks: p._count.tasks, documents: p._count.documents, done: p.tasks.filter((t) => t.status === "DONE").length },
    })),
  });
});

export const POST = route({ body: Create }, async (req, ctx, input) => {
  const base = slugify(input.body.name);
  let slug = base;
  let n = 1;
  while (await prisma.project.findUnique({ where: { workspaceId_slug: { workspaceId: ctx.auth.workspaceId, slug } } })) {
    slug = `${base}-${++n}`;
  }
  const project = await prisma.project.create({
    data: {
      workspaceId: ctx.auth.workspaceId,
      ownerId: ctx.auth.userId,
      name: input.body.name,
      slug,
      description: input.body.description ?? null,
      objective: input.body.objective ?? null,
      targetDate: input.body.targetDate ? new Date(input.body.targetDate) : null,
      color: input.body.color,
    },
  });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: ctx.auth.userId, role: "OWNER" } });
  await recordActivity({
    workspaceId: ctx.auth.workspaceId,
    userId: ctx.auth.userId,
    projectId: project.id,
    kind: "PROJECT",
    action: "project.create",
    summary: `Created project “${project.name}”`,
    entityType: "PROJECT",
    entityId: project.id,
    status: "success",
  });
  return ok({ project }, { status: 201 });
});
