/**
 * Job / queue abstraction.
 *
 * Two drivers behind one interface:
 *
 *   inline — the handler runs immediately, in-process. Records a Job row so the
 *            work is auditable even though it is not deferred.
 *   queue  — the job is persisted as QUEUED and claimed later by a worker
 *            (`processDue`), with retries, exponential backoff and a dead-letter
 *            state after `maxAttempts`.
 *
 * Handlers are registered by type at module load. Switching drivers changes
 * only *when* the work happens — never what it does.
 */

import { prisma } from '../db';
import { env } from '../env';
import { createLogger } from '../logger';
import { toNexusError, NexusError } from '../errors';
import { recordActivity } from '../../server/services/activity';

export type JobType = 'workflow.run';

export type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>;

export interface EnqueueOptions {
  /** Delay execution until this time (queue driver honours it; inline runs now). */
  runAfter?: Date;
  maxAttempts?: number;
  workspaceId?: string | null;
  userId?: string | null;
  projectId?: string | null;
}

export interface EnqueueResult {
  id: string;
  type: string;
  status: string;
  /** Present only when the driver executed the job synchronously. */
  result?: unknown;
  error?: string;
}

const logger = createLogger('jobs');

const handlers = new Map<string, JobHandler>();
let defaultsLoaded = false;

/** Handler registration happens once, lazily, to avoid import cycles. */
export async function ensureHandlers(): Promise<void> {
  if (defaultsLoaded) return;
  defaultsLoaded = true;
  await import('./handlers');
}

export function registerHandler(type: JobType | string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export function registeredTypes(): string[] {
  return [...handlers.keys()];
}

export function driverName(): 'inline' | 'queue' {
  return env.jobDriver;
}

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Persist a job and, depending on the driver, run it. */
export async function enqueue(type: JobType | string, payload: Record<string, unknown>, options: EnqueueOptions = {}): Promise<EnqueueResult> {
  await ensureHandlers();

  const job = await prisma.job.create({
    data: {
      type,
      payload: JSON.stringify(payload),
      status: 'QUEUED',
      maxAttempts: options.maxAttempts ?? 3,
      runAfter: options.runAfter ?? new Date(),
    },
  });

  if (driverName() === 'inline') {
    return runJob(job.id);
  }

  return { id: job.id, type, status: 'QUEUED' };
}

/**
 * Claim and execute one job. Claiming is a guarded update (`QUEUED → RUNNING`)
 * so two workers can never pick up the same row.
 */
export async function runJob(id: string): Promise<EnqueueResult> {
  const claimed = await prisma.job.updateMany({
    where: { id, status: { in: ['QUEUED'] } },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
  });

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) throw new NexusError('NOT_FOUND', `Job ${id} not found`);
  if (claimed.count === 0 && job.status !== 'RUNNING') {
    return { id, type: job.type, status: job.status, error: job.lastError ?? 'Job is not claimable' };
  }

  const handler = handlers.get(job.type);
  if (!handler) {
    const message = `No handler registered for job type "${job.type}"`;
    await prisma.job.update({ where: { id }, data: { status: 'FAILED', lastError: message, completedAt: new Date() } });
    logger.error(message, { jobId: id });
    return { id, type: job.type, status: 'FAILED', error: message };
  }

  try {
    const payload = safeParse<Record<string, unknown>>(job.payload, {});
    const result = await handler(payload);
    await prisma.job.update({
      where: { id },
      data: { status: 'COMPLETED', result: JSON.stringify(result ?? null), completedAt: new Date(), lastError: null },
    });
    await recordActivity({
      workspaceId: (payload.workspaceId as string | undefined) ?? null,
      userId: (payload.userId as string | undefined) ?? null,
      projectId: (payload.projectId as string | undefined) ?? null,
      type: 'SYSTEM',
      action: `Job completed: ${job.type}`,
      summary: `Job ${id} finished on the ${driverName()} driver.`,
      severity: 'SUCCESS',
    });
    return { id, type: job.type, status: 'COMPLETED', result };
  } catch (error) {
    const nexus = toNexusError(error);
    const attempts = job.attempts + 1;
    const retryable = nexus.retryable && attempts < job.maxAttempts;

    await prisma.job.update({
      where: { id },
      data: retryable
        ? { status: 'QUEUED', lastError: nexus.message, runAfter: new Date(Date.now() + 2 ** attempts * 1000) }
        : { status: 'FAILED', lastError: nexus.message, completedAt: new Date() },
    });

    logger.error(`job failed: ${nexus.message}`, { jobId: id, type: job.type, attempts, retryable });

    if (driverName() === 'inline') {
      // Inline callers are waiting on this result — surface the failure.
      throw nexus;
    }
    return { id, type: job.type, status: retryable ? 'QUEUED' : 'FAILED', error: nexus.message };
  }
}

/** Drain due jobs. Called by the worker endpoint; a no-op result set for inline. */
export async function processDue(limit = 10): Promise<{ processed: number; succeeded: number; failed: number; requeued: number }> {
  await ensureHandlers();

  const due = await prisma.job.findMany({
    where: { status: 'QUEUED', runAfter: { lte: new Date() } },
    orderBy: { runAfter: 'asc' },
    take: limit,
  });

  const tally = { processed: 0, succeeded: 0, failed: 0, requeued: 0 };
  for (const job of due) {
    const outcome = await runJob(job.id);
    tally.processed++;
    if (outcome.status === 'COMPLETED') tally.succeeded++;
    else if (outcome.status === 'FAILED') tally.failed++;
    else if (outcome.status === 'QUEUED') tally.requeued++;
  }
  return tally;
}

export async function jobStats(): Promise<Record<string, number>> {
  const grouped = await prisma.job.groupBy({ by: ['status'], _count: { _all: true } });
  return Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
}
