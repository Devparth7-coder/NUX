import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";

type Params = { id: string };

/** Full execution state for the live execution view. */
export const GET = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const intent = await prisma.intent.findFirst({
    where: { id, workspaceId: ctx.auth.workspaceId },
    include: {
      project: { select: { id: true, name: true, health: true, progress: true, targetDate: true } },
      runs: {
        where: { parentRunId: null },
        include: {
          children: { orderBy: { createdAt: "asc" } },
          events: { orderBy: { at: "asc" }, take: 200 },
        },
      },
      artifacts: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!intent) throw Errors.notFound("Intent");

  const runIds = intent.runs.flatMap((r) => [r.id, ...r.children.map((c) => c.id)]);
  const [approvals, executions] = await Promise.all([
    prisma.approval.findMany({ where: { runId: { in: runIds } }, orderBy: { createdAt: "asc" } }),
    prisma.toolExecution.findMany({ where: { runId: { in: runIds } }, orderBy: { createdAt: "asc" } }),
  ]);

  return ok({
    intent: {
      id: intent.id,
      rawInput: intent.rawInput,
      objective: intent.objective,
      desiredOutcome: intent.desiredOutcome,
      entities: intent.entities,
      constraints: intent.constraints,
      deadlineText: intent.deadlineText,
      deadline: intent.deadline,
      capabilities: intent.capabilities,
      riskLevel: intent.riskLevel,
      permissions: intent.permissions,
      status: intent.status,
      confidence: intent.confidence,
      createdAt: intent.createdAt,
      completedAt: intent.completedAt,
      project: intent.project,
    },
    runs: intent.runs,
    approvals,
    executions,
    artifacts: intent.artifacts,
    result: (intent.metadata as { result?: unknown } | null)?.result ?? null,
  });
});
