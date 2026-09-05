import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { hybridSearch } from "@/lib/retrieval/hybrid";

export const GET = route({ auth: true }, async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q");
  const projectId = sp.get("projectId");

  const items = await prisma.knowledgeItem.findMany({
    where: { workspaceId: ctx.auth.workspaceId, ...(projectId ? { projectId } : {}) },
    orderBy: [{ salience: "desc" }, { updatedAt: "desc" }],
    take: 120,
    include: { project: { select: { id: true, name: true } }, document: { select: { id: true, title: true } } },
  });

  const relations = await prisma.knowledgeRelation.findMany({
    where: { source: { workspaceId: ctx.auth.workspaceId } },
    select: { id: true, sourceId: true, targetId: true, type: true, weight: true, evidence: true },
    take: 400,
  });

  let matches: Array<{ id: string; label: string; score: number; why: string[] }> = [];
  if (q && q.length > 2) {
    const results = await hybridSearch({
      workspaceId: ctx.auth.workspaceId,
      query: q,
      projectId: projectId ?? null,
      includeDocuments: false,
      includeTasks: false,
      includeMemory: false,
      limit: 10,
    });
    matches = results.map((r) => ({ id: r.id, label: r.title, score: r.score.total, why: r.why }));
  }

  return ok({ items, relations, matches });
});

const Create = z.object({
  label: z.string().min(2).max(160),
  content: z.string().min(4).max(4000),
  kind: z.enum(["FACT", "DECISION", "CONCEPT", "PERSON", "ORGANIZATION", "TECHNOLOGY", "RISK", "INSIGHT"]).default("FACT"),
  projectId: z.string().nullish(),
  documentId: z.string().nullish(),
  confidence: z.number().min(0).max(1).default(0.8),
});

export const POST = route({ body: Create }, async (_req, ctx, input) => {
  const item = await prisma.knowledgeItem.create({
    data: {
      workspaceId: ctx.auth.workspaceId,
      projectId: input.body.projectId ?? null,
      documentId: input.body.documentId ?? null,
      kind: input.body.kind,
      label: input.body.label,
      content: input.body.content,
      confidence: input.body.confidence,
      source: "user",
    },
  });
  const { embedTexts } = await import("@/lib/retrieval/embeddings");
  const { storeVector } = await import("@/lib/retrieval/vector-store");
  const [vector] = await embedTexts([`${item.label} ${item.content}`]);
  await storeVector("KnowledgeItem", item.id, vector);
  return ok({ item }, { status: 201 });
});
