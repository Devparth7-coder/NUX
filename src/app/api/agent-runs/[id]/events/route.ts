import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";

type Params = { id: string };

export const GET = route<undefined, undefined, Params>({ auth: true }, async (req, ctx) => {
  const { id } = await ctx.params;
  const since = new URL(req.url).searchParams.get("since");
  const events = await prisma.runEvent.findMany({
    where: { OR: [{ runId: id }, { intentId: id }], ...(since ? { id: { gt: since } } : {}) },
    orderBy: { at: "asc" },
    take: 300,
  });
  return ok({ events });
});
