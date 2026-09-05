import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { storage } from '@/lib/storage';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await requireUser();
  const document = await prisma.document.findFirst({ where: { id, workspaceId: user.workspaceId } });
  if (!document) throw notFound('Document not found');

  const data = await storage().get(document.storageKey);
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': document.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(document.title)}"`,
    },
  });
}
