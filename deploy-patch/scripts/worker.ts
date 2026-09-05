/**
 * Queue worker. One drain, then exit — the shape Render's cron service expects.
 *
 *   npm run worker            # drain up to 20 due jobs
 *   npm run worker -- 50      # drain up to 50
 *
 * Only meaningful when NEXUS_JOB_DRIVER=queue. With the inline driver there is
 * never anything queued, and this exits immediately.
 */

import { prisma } from '../src/lib/db';
import { ensureHandlers, jobStats, processDue, driverName } from '../src/lib/jobs';

async function main() {
  const limit = Number(process.argv[2] ?? 20);
  await ensureHandlers();

  const before = await jobStats();
  const result = await processDue(Number.isFinite(limit) ? limit : 20);
  const after = await jobStats();

  console.log(
    `[worker] driver=${driverName()} processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} requeued=${result.requeued}`,
  );
  console.log(`[worker] queue before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('[worker] failed', error);
    await prisma.$disconnect();
    process.exit(1);
  });
