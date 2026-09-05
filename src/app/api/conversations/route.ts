import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";

const Create = z.object({ title: z.string().min(2).max(200), projectId: z.string().nullish() });

export const GET = route({ auth: true }, async (_req, ctx) => {
  const conversations = await prisma.conversation.findMany({
    where: { userId: ctx.auth.userId, archived: false },
    orderBy: { updatedAt: "desc" },
    take: 30,
    include: {
      project: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
      intents: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, objective: true, createdAt: true } },
    },
  });
  return ok({ conversations });
});

export const POST = route({ body: Create }, async (_req, ctx, input) => {
  const conversation = await prisma.conversation.create({
    data: { userId: ctx.auth.userId, title: input.body.title, projectId: input.body.projectId ?? null },
  });
  return ok({ conversation }, { status: 201 });
});
