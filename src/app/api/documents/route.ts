import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { ingestDocument, MAX_UPLOAD_BYTES } from '@/lib/ingestion/pipeline';
import { NexusError } from '@/lib/errors';
import { handler, ok } from '@/lib/api/response';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const projectId = req.nextUrl.searchParams.get('projectId');
  const documents = await prisma.document.findMany({
    where: { workspaceId: user.workspaceId, ...(projectId ? { projectId } : {}) },
    orderBy: { createdAt: 'desc' },
    include: { project: { select: { id: true, name: true } } },
    take: 200,
  });
  return ok({ items: documents });
});

/** Upload → validate → extract → chunk → embed → index → knowledge graph. */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const form = await req.formData();
  const file = form.get('file');
  const projectId = (form.get('projectId') as string | null) ?? null;

  if (!(file instanceof File)) throw new NexusError('VALIDATION', 'No file provided');
  if (file.size > MAX_UPLOAD_BYTES) throw new NexusError('VALIDATION', 'File exceeds 20MB limit');

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await ingestDocument({
    workspaceId: user.workspaceId,
    userId: user.id,
    projectId,
    filename: file.name,
    mimeType: file.type || 'text/plain',
    buffer,
  });

  return ok({ document: result }, { status: 201 });
});
