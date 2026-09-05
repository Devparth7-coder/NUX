import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await requireUser();
  const artifact = await prisma.artifact.findFirst({ where: { id, userId: user.id } });
  if (!artifact) throw notFound('Artifact not found');

  const ext = artifact.format === 'json' ? 'json' : artifact.format === 'html' ? 'html' : 'md';
  return new Response(artifact.content, {
    headers: {
      'Content-Type': artifact.format === 'json' ? 'application/json' : 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${artifact.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${ext}"`,
    },
  });
}
