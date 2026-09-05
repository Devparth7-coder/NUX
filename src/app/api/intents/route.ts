import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { startRun } from "@/server/pipeline/run-service";

const Create = z.object({
  input: z.string().min(4).max(4000),
  conversationId: z.string().nullish(),
  projectId: z.string().nullish(),
});

/**
 * COMMAND entry point: creates the intent, runs the Context Engine, builds the
 * execution graph and hands execution to the background job queue.
 */
export const POST = route({ body: Create, rateLimit: { limit: 30, windowMs: 60_000 } }, async (_req, ctx, input) => {
  const prefs = await prisma.userPreference.findUnique({ where: { userId: ctx.auth.userId } });

  let conversationId = input.body.conversationId ?? null;
  if (!conversationId) {
    const conversation = await prisma.conversation.create({
      data: {
        userId: ctx.auth.userId,
        projectId: input.body.projectId ?? null,
        title: input.body.input.slice(0, 80),
      },
    });
    conversationId = conversation.id;
  }

  await prisma.message.create({
    data: {
      conversationId,
      userId: ctx.auth.userId,
      role: "user",
      kind: "message",
      content: input.body.input,
    },
  });

  const result = await startRun({
    workspaceId: ctx.auth.workspaceId,
    userId: ctx.auth.userId,
    rawInput: input.body.input,
    conversationId,
    projectId: input.body.projectId ?? null,
    autoApproveRead: prefs?.autoApproveRead ?? true,
  });

  await prisma.message.create({
    data: {
      conversationId,
      role: "nexus",
      kind: "intent",
      content: `Understood: ${result.intent.objective}${result.intent.deadlineText ? ` · ${result.intent.deadlineText}` : ""}`,
      intentId: result.intentId,
      runId: result.runId,
      structured: { intent: result.intent, context: result.context, graph: result.graph } as never,
    },
  });

  return ok({ ...result, conversationId }, { status: 202 });
});

export const GET = route({ auth: true }, async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const projectId = sp.get("projectId");
  const intents = await prisma.intent.findMany({
    where: { workspaceId: ctx.auth.workspaceId, ...(projectId ? { projectId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      runs: { where: { parentRunId: null }, select: { id: true, status: true, createdAt: true, progress: true } },
      project: { select: { id: true, name: true } },
    },
  });
  return ok({ intents });
});
