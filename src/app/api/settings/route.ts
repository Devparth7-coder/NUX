import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { listProviders, getProvider } from '@/lib/ai';
import { env } from '@/lib/env';
import { handler, ok, validationError } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async () => {
  const user = await requireUser();
  const rows = await prisma.setting.findMany({ where: { userId: user.id } });
  const settings: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    settings[row.namespace] = { ...(settings[row.namespace] ?? {}), [row.key]: JSON.parse(row.value) };
  }
  return ok({
    settings,
    providers: listProviders(),
    activeProvider: getProvider().id,
    mode: getProvider().mode,
    model: env.aiModel,
    embeddingModel: env.embedModel,
    dbProvider: env.dbProvider,
    storageDriver: env.storageDriver,
    jobDriver: env.jobDriver,
  });
});

const patchSchema = z.object({
  namespace: z.enum(['ai', 'agents', 'memory', 'permissions', 'notifications', 'appearance', 'security', 'profile']),
  key: z.string().min(1).max(60),
  value: z.unknown(),
});

export const PATCH = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const setting = await prisma.setting.upsert({
    where: { userId_namespace_key: { userId: user.id, namespace: parsed.data.namespace, key: parsed.data.key } },
    create: { userId: user.id, namespace: parsed.data.namespace, key: parsed.data.key, value: JSON.stringify(parsed.data.value ?? {}) },
    update: { value: JSON.stringify(parsed.data.value ?? {}) },
  });
  return ok({ setting });
});
