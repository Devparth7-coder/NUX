import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { queue } from "@/lib/jobs/queue";
import { validateWorkflow } from "@/lib/orchestration/workflow-validate";
import "@/lib/orchestration/workflow-engine";

type Params = { id: string };

const Body = z.object({
  input: z.record(z.unknown()).default({}),
  projectId: z.string().nullish(),
});

export const POST = route<typeof Body, undefined, Params>({ body: Body }, async (_req, ctx, input) => {
  const { id } = await ctx.params;
  const workflow = await prisma.workflow.findFirst({
    where: { id, workspaceId: ctx.auth.workspaceId },
    include: { nodes: true, edges: true },
  });
  if (!workflow) throw Errors.notFound("Workflow");

  const validation = validateWorkflow(workflow.nodes as never, workflow.edges as never);
  if (!validation.ok) throw Errors.validation({ errors: validation.errors });

  const run = await prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      workspaceId: ctx.auth.workspaceId,
      userId: ctx.auth.userId,
      status: "QUEUED",
      version: workflow.version,
      input: { ...input.body.input, projectId: input.body.projectId ?? null } as never,
    },
  });

  queue.enqueue("workflow.run", { workflowRunId: run.id }, { maxAttempts: 2 });
  return ok({ runId: run.id }, { status: 202 });
});
