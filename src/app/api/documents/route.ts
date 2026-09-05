import { prisma } from "@/lib/db";
import { route, ok, parsePage } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { ingestDocument } from "@/server/services/ingestion";

export const GET = route({ auth: true }, async (req, ctx) => {
  const sp = new URL(req.url).searchParams;
  const { skip, take, page, pageSize } = parsePage(sp, 30);
  const projectId = sp.get("projectId");
  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where: { workspaceId: ctx.auth.workspaceId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { project: { select: { id: true, name: true, color: true } } },
    }),
    prisma.document.count({ where: { workspaceId: ctx.auth.workspaceId, ...(projectId ? { projectId } : {}) } }),
  ]);
  return ok({ page, pageSize, total, documents });
});

/** Multipart upload → real ingestion pipeline (extract → chunk → embed → index). */
export const POST = route({ auth: true, rateLimit: { limit: 30, windowMs: 60_000 } }, async (req, ctx) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw Errors.validation({ message: "Expected multipart form data" });
  const file = form.get("file");
  const rawProjectId = (form.get("projectId") as string | null) ?? null;
  const projectId = rawProjectId && rawProjectId.length > 0 ? rawProjectId : null;
  if (!(file instanceof File)) throw Errors.validation({ message: "Missing file field" });

  // Tenant isolation: the target project must belong to this workspace.
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId: ctx.auth.workspaceId }, select: { id: true } });
    if (!project) throw Errors.notFound("Project");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await ingestDocument({
    workspaceId: ctx.auth.workspaceId,
    userId: ctx.auth.userId,
    projectId,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    buffer,
  });
  return ok({ document: result }, { status: 201 });
});
