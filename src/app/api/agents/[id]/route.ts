import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";

type Params = { id: string };

const Patch = z.object({
  status: z.enum(["ACTIVE", "IDLE", "DISABLED"]).nullish(),
  model: z.string().nullish(),
  temperature: z.number().min(0).max(2).nullish(),
});

export const GET = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const agent = await prisma.agent.findFirst({
    where: { id, workspaceId: ctx.auth.workspaceId },
    include: {
      runs: { orderBy: { createdAt: "desc" }, take: 40, select: { id: true, status: true, latencyMs: true, tokensIn: true, tokensOut: true, createdAt: true, intentId: true } },
    },
  });
  if (!agent) throw Errors.notFound("Agent");
  const succeeded = agent.runs.filter((r) => r.status === "COMPLETED").length;
  return ok({
    agent,
    stats: {
      runs: agent.runs.length,
      succeeded,
      failed: agent.runs.filter((r) => r.status === "FAILED").length,
      successRate: agent.runs.length ? succeeded / agent.runs.length : null,
      avgLatencyMs: agent.runs.length ? Math.round(agent.runs.reduce((a, r) => a + (r.latencyMs ?? 0), 0) / agent.runs.length) : null,
    },
  });
});

export const PATCH = route<typeof Patch, undefined, Params>({ body: Patch }, async (_req, ctx, input) => {
  const { id } = await ctx.params;
  const agent = await prisma.agent.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!agent) throw Errors.notFound("Agent");
  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: {
      status: input.body.status ?? undefined,
      model: input.body.model ?? undefined,
      temperature: input.body.temperature ?? undefined,
    },
  });
  return ok({ agent: updated });
});
