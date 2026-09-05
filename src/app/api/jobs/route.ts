import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { processDue, jobStats, driverName, registeredTypes, ensureHandlers } from '@/lib/jobs';
import { handler, ok, validationError } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async () => {
  await requireUser();
  await ensureHandlers();
  const [stats, recent] = await Promise.all([
    jobStats(),
    prisma.job.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  return ok({ driver: driverName(), handlers: registeredTypes(), stats, recent });
});

const schema = z.object({ limit: z.number().int().min(1).max(50).optional() });

/** Worker tick: claim and execute due jobs. Safe to call on any driver. */
export const POST = handler(async (req: NextRequest) => {
  await requireUser();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);
  const result = await processDue(parsed.data.limit ?? 10);
  return ok({ driver: driverName(), ...result });
});
