/**
 * Worker tick for the queue driver.
 *
 * Vercel Cron invokes this on a schedule and sends
 * `Authorization: Bearer $CRON_SECRET`. Without a matching secret the endpoint
 * returns 401 — the queue can never be drained by an anonymous request.
 */

import { NextRequest } from 'next/server';
import { jobStats, processDue, driverName } from '@/lib/jobs';
import { handler, ok } from '@/lib/api/response';
import { unauthorized } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export const GET = handler(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization') ?? '';

  if (!secret) {
    // No secret configured means no scheduled worker is allowed.
    throw unauthorized('CRON_SECRET is not configured; the scheduled worker is disabled.');
  }
  if (header !== `Bearer ${secret}`) throw unauthorized('Invalid cron authorization');

  const result = await processDue(20);
  return ok({ driver: driverName(), ...result, stats: await jobStats() });
});
