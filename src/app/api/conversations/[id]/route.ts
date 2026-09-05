import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";

type Params = { id: string };

export const GET = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: ctx.auth.userId },
    include: {
      project: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 200 },
      intents: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { runs: { where: { parentRunId: null }, select: { id: true, status: true, createdAt: true, outputs: true } } },
      },
    },
  });
  if (!conversation) throw Errors.notFound("Conversation");
  return ok({ conversation });
});

export const DELETE = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const conversation = await prisma.conversation.findFirst({ where: { id, userId: ctx.auth.userId } });
  if (!conversation) throw Errors.notFound("Conversation");
  await prisma.conversation.delete({ where: { id: conversation.id } });
  return ok({ deleted: true });
});
