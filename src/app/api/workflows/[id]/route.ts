import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { validateWorkflow } from "@/lib/orchestration/workflow-validate";

type Params = { id: string };

const Patch = z.object({
  name: z.string().min(3).max(120).nullish(),
  description: z.string().max(1000).nullish(),
  status: z.enum(["DRAFT", "ACTIVE", "DISABLED", "ARCHIVED"]).nullish(),
  nodes: z
    .array(
      z.object({
        key: z.string(),
        type: z.enum(["TRIGGER", "AGENT", "TOOL", "CONDITION", "APPROVAL", "DELAY", "BRANCH", "LOOP", "OUTPUT"]),
        label: z.string(),
        config: z.record(z.unknown()).default({}),
        positionX: z.number().default(0),
        positionY: z.number().default(0),
      }),
    )
    .nullish(),
  edges: z.array(z.object({ sourceKey: z.string(), targetKey: z.string(), label: z.string().nullish(), condition: z.string().nullish() })).nullish(),
});

export const GET = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const workflow = await prisma.workflow.findFirst({
    where: { id, workspaceId: ctx.auth.workspaceId },
    include: { nodes: { orderBy: { positionY: "asc" } }, edges: true, runs: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!workflow) throw Errors.notFound("Workflow");
  const validation = validateWorkflow(workflow.nodes as never, workflow.edges as never);
  return ok({ workflow, validation });
});

export const PATCH = route<typeof Patch, undefined, Params>({ body: Patch }, async (_req, ctx, input) => {
  const { id } = await ctx.params;
  const workflow = await prisma.workflow.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!workflow) throw Errors.notFound("Workflow");

  const updated = await prisma.workflow.update({
    where: { id: workflow.id },
    data: {
      name: input.body.name ?? undefined,
      description: input.body.description ?? undefined,
      status: input.body.status ?? undefined,
      version: input.body.nodes ? { increment: 1 } : undefined,
      definition: input.body.nodes ? ({ nodes: input.body.nodes, edges: input.body.edges ?? [] } as never) : undefined,
    },
  });

  if (input.body.nodes) {
    await prisma.workflowNode.deleteMany({ where: { workflowId: workflow.id } });
    await prisma.workflowEdge.deleteMany({ where: { workflowId: workflow.id } });
    await prisma.workflowNode.createMany({
      data: input.body.nodes.map((n) => ({
        workflowId: workflow.id,
        key: n.key,
        type: n.type,
        label: n.label,
        config: n.config as never,
        positionX: n.positionX,
        positionY: n.positionY,
      })),
    });
    const created = await prisma.workflowNode.findMany({ where: { workflowId: workflow.id } });
    const keyToId = new Map(created.map((n) => [n.key, n.id]));
    if (input.body.edges?.length) {
      await prisma.workflowEdge.createMany({
        data: input.body.edges
          .map((e) => ({ workflowId: workflow.id, sourceId: keyToId.get(e.sourceKey) ?? "", targetId: keyToId.get(e.targetKey) ?? "", label: e.label, condition: e.condition }))
          .filter((e) => e.sourceId && e.targetId),
      });
    }
  }

  return ok({ workflow: updated });
});

export const DELETE = route<undefined, undefined, Params>({ auth: true }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const workflow = await prisma.workflow.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!workflow) throw Errors.notFound("Workflow");
  await prisma.workflow.delete({ where: { id: workflow.id } });
  return ok({ deleted: true });
});
