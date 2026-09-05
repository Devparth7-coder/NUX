import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";

const NodeInput = z.object({
  key: z.string(),
  type: z.enum(["TRIGGER", "AGENT", "TOOL", "CONDITION", "APPROVAL", "DELAY", "BRANCH", "LOOP", "OUTPUT"]),
  label: z.string(),
  config: z.record(z.unknown()).default({}),
  positionX: z.number().default(0),
  positionY: z.number().default(0),
});

const EdgeInput = z.object({ sourceKey: z.string(), targetKey: z.string(), label: z.string().nullish(), condition: z.string().nullish() });

const Create = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(1000).nullish(),
  nodes: z.array(NodeInput).default([]),
  edges: z.array(EdgeInput).default([]),
  status: z.enum(["DRAFT", "ACTIVE"]).default("DRAFT"),
});

export const GET = route({ auth: true }, async (_req, ctx) => {
  const workflows = await prisma.workflow.findMany({
    where: { workspaceId: ctx.auth.workspaceId },
    orderBy: { updatedAt: "desc" },
    include: {
      nodes: true,
      edges: true,
      runs: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, createdAt: true } },
    },
  });
  return ok({ workflows });
});

export const POST = route({ body: Create }, async (_req, ctx, input) => {
  const { nodes, edges } = input.body;
  const workflow = await prisma.workflow.create({
    data: {
      workspaceId: ctx.auth.workspaceId,
      userId: ctx.auth.userId,
      name: input.body.name,
      description: input.body.description ?? null,
      status: input.body.status,
      definition: { nodes, edges } as never,
      nodes: {
        create: nodes.map((n) => ({ key: n.key, type: n.type, label: n.label, config: n.config as never, positionX: n.positionX, positionY: n.positionY })),
      },
    },
    include: { nodes: true },
  });

  if (edges.length) {
    const keyToId = new Map(workflow.nodes.map((n) => [n.key, n.id]));
    await prisma.workflowEdge.createMany({
      data: edges
        .map((e) => ({ workflowId: workflow.id, sourceId: keyToId.get(e.sourceKey) ?? "", targetId: keyToId.get(e.targetKey) ?? "", label: e.label ?? null, condition: e.condition ?? null }))
        .filter((e) => e.sourceId && e.targetId),
    });
  }

  return ok({ workflow }, { status: 201 });
});
