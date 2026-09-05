import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { embedTexts } from "@/lib/retrieval/embeddings";
import { storeVector } from "@/lib/retrieval/vector-store";

type Params = { id: string };

const Patch = z.object({
  content: z.string().min(8).max(2000).nullish(),
  enabled: z.boolean().nullish(),
  pinned: z.boolean().nullish(),
  importance: z.number().min(0).max(1).nullish(),
  type: z.enum(["SHORT_TERM", "PROJECT", "LONG_TERM", "EXPLICIT"]).nullish(),
});

export const PATCH = route<typeof Patch, undefined, Params>({ body: Patch }, async (_req, ctx, input) => {
  const { id } = await ctx.params;
  const memory = await prisma.memory.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!memory) throw Errors.notFound("Memory");
  const updated = await prisma.memory.update({
    where: { id: memory.id },
    data: {
      content: input.body.content ?? undefined,
      enabled: input.body.enabled ?? undefined,
      pinned: input.body.pinned ?? undefined,
      importance: input.body.importance ?? undefined,
      type: input.body.type ?? undefined,
    },
  });
  if (input.body.content) {
    const [vector] = await embedTexts([input.body.content]);
    await storeVector("Memory", updated.id, vector);
  }
  return ok({ memory: updated });
});

export const DELETE = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const memory = await prisma.memory.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!memory) throw Errors.notFound("Memory");
  await prisma.memory.delete({ where: { id: memory.id } });
  return ok({ deleted: true });
});
