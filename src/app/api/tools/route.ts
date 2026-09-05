import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import "@/lib/tools";

export const GET = route({ auth: true }, async (req, ctx) => {
  const category = new URL(req.url).searchParams.get("category");
  const [tools, integrations] = await Promise.all([
    prisma.tool.findMany({
      where: { workspaceId: ctx.auth.workspaceId, ...(category ? { category } : {}) },
      orderBy: [{ category: "asc" }, { key: "asc" }],
    }),
    prisma.integration.findMany({ where: { workspaceId: ctx.auth.workspaceId }, select: { kind: true, status: true } }),
  ]);
  const statusByKind = new Map(integrations.map((i) => [i.kind, i.status]));
  return ok({
    tools: tools.map((t) => ({
      ...t,
      integrationStatus: t.requiresAuth ? (statusByKind.get(t.requiresAuth as never) ?? "NOT_CONFIGURED") : null,
    })),
  });
});
