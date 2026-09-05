import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { recordActivity, audit } from '@/server/services/activity';
import { handler, ok, validationError } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

const patchSchema = z.object({
  action: z.enum(['connect', 'disconnect']),
  accountLabel: z.string().max(120).optional(),
  credentials: z.string().max(4000).optional(),
});

/**
 * Connect / disconnect an integration.
 * Credentials are stored server-side only and never returned by any endpoint.
 */
export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ key: string }> }) => {
  const user = await requireUser();
  const { key } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const existing = await prisma.integration.findUnique({ where: { userId_key: { userId: user.id, key } } });
  if (!existing) throw notFound('Integration not found');

  if (parsed.data.action === 'disconnect') {
    const updated = await prisma.integration.update({
      where: { id: existing.id },
      data: { status: 'DISCONNECTED', credentials: null, accountLabel: null },
    });
    await audit({ userId: user.id, action: 'integration.disconnect', entityType: 'INTEGRATION', entityId: existing.id });
    await recordActivity({
      workspaceId: user.workspaceId,
      userId: user.id,
      type: 'INTEGRATION',
      action: 'Integration disconnected',
      summary: key,
      severity: 'INFO',
    });
    return ok({ integration: { ...updated, credentials: undefined } });
  }

  const updated = await prisma.integration.update({
    where: { id: existing.id },
    data: {
      status: 'CONNECTED',
      accountLabel: parsed.data.accountLabel ?? `${key} account`,
      credentials: parsed.data.credentials ?? existing.credentials,
      lastSyncedAt: new Date(),
    },
  });

  await audit({ userId: user.id, action: 'integration.connect', entityType: 'INTEGRATION', entityId: existing.id });
  await recordActivity({
    workspaceId: user.workspaceId,
    userId: user.id,
    type: 'INTEGRATION',
    action: 'Integration connected',
    summary: key,
    severity: 'SUCCESS',
  });

  return ok({ integration: { ...updated, credentials: undefined } });
});
