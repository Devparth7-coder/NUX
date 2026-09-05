import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { hybridSearchChunks } from '@/lib/retrieval/search';
import { storage } from '@/lib/storage';
import { handler, ok } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const query = req.nextUrl.searchParams.get('q');

  const document = await prisma.document.findFirst({
    where: { id, workspaceId: user.workspaceId },
    include: { project: { select: { id: true, name: true } } },
  });
  if (!document) throw notFound('Document not found');

  let passages: Awaited<ReturnType<typeof hybridSearchChunks>> = [];
  if (query) {
    passages = await hybridSearchChunks({ workspaceId: user.workspaceId, query, limit: 12 });
    passages = passages.filter((p) => p.documentId === id);
  }

  const chunks = await prisma.documentChunk.findMany({
    where: { documentId: id },
    orderBy: { position: 'asc' },
    select: { id: true, content: true, page: true, section: true, position: true, tokenCount: true },
  });

  return ok({ document, chunks, passages });
});

export const DELETE = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const document = await prisma.document.findFirst({ where: { id, workspaceId: user.workspaceId } });
  if (!document) throw notFound('Document not found');

  await storage().delete(document.storageKey).catch(() => undefined);
  await prisma.document.delete({ where: { id } });
  return ok({ deleted: true });
});
