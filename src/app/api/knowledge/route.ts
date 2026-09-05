import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { embedSyncSerialized } from '@/lib/ai';
import { handler, ok, validationError } from '@/lib/api/response';

export const runtime = 'nodejs';

const createSchema = z.object({
  title: z.string().min(2).max(200),
  content: z.string().max(8000).optional(),
  type: z.enum(['PROJECT', 'PERSON', 'DOCUMENT', 'TASK', 'CONCEPT', 'DECISION', 'TECHNOLOGY', 'ORGANIZATION']).default('CONCEPT'),
  projectId: z.string().optional().nullable(),
  confidence: z.number().min(0).max(1).default(0.8),
});

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const projectId = req.nextUrl.searchParams.get('projectId');
  const items = await prisma.knowledgeItem.findMany({
    where: { workspaceId: user.workspaceId, ...(projectId ? { projectId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: 300,
  });
  const relations = await prisma.knowledgeRelation.findMany({
    where: { from: { workspaceId: user.workspaceId } },
  });
  return ok({ items, relations });
});

export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const item = await prisma.knowledgeItem.create({
    data: {
      workspaceId: user.workspaceId,
      projectId: parsed.data.projectId ?? null,
      title: parsed.data.title,
      content: parsed.data.content ?? '',
      summary: (parsed.data.content ?? '').slice(0, 280),
      type: parsed.data.type,
      confidence: parsed.data.confidence,
      source: 'USER',
      embedding: embedSyncSerialized(`${parsed.data.title} ${parsed.data.content ?? ''}`),
    },
  });
  return ok({ item }, { status: 201 });
});
