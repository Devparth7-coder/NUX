import { log } from "@/lib/logger";

export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "DELAYED";

export type Job<T = unknown> = {
  id: string;
  name: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
};

type Handler<T = unknown> = (payload: T, job: Job<T>) => Promise<void>;

/**
 * Process-local durable-enough job runner: concurrency control, retries with
 * exponential backoff, delayed scheduling and cancellation.
 *
 * Job *state* that matters to the user is persisted on AgentRun / ToolExecution
 * rows by the handlers themselves, so a restart leaves recoverable records
 * behind (see server/pipeline/recovery.ts).
 */
class JobQueue {
  private handlers = new Map<string, Handler<never>>();
  private jobs = new Map<string, Job>();
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Set<string>();
  private concurrency = 4;
  private workerActive = false;

  register<T>(name: string, handler: Handler<T>) {
    this.handlers.set(name, handler as Handler<never>);
  }

  enqueue<T>(name: string, payload: T, opts: { delayMs?: number; maxAttempts?: number; id?: string } = {}): Job<T> {
    const id = opts.id ?? `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const job: Job<T> = {
      id,
      name,
      payload,
      status: opts.delayMs ? "DELAYED" : "QUEUED",
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 2,
      runAt: Date.now() + (opts.delayMs ?? 0),
      createdAt: Date.now(),
    };
    this.jobs.set(id, job as Job);
    if (opts.delayMs) {
      this.timers.set(
        id,
        setTimeout(() => {
          job.status = "QUEUED";
          void this.pump();
        }, opts.delayMs),
      );
    } else {
      void this.pump();
    }
    return job;
  }

  cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) return false;
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    job.status = "CANCELLED";
    job.finishedAt = Date.now();
    return true;
  }

  get(id: string) {
    return this.jobs.get(id);
  }

  stats() {
    const all = [...this.jobs.values()];
    return {
      total: all.length,
      queued: all.filter((j) => j.status === "QUEUED").length,
      running: this.running.size,
      failed: all.filter((j) => j.status === "FAILED").length,
      succeeded: all.filter((j) => j.status === "SUCCEEDED").length,
    };
  }

  private async pump() {
    if (this.workerActive) return;
    this.workerActive = true;
    try {
      while (true) {
        if (this.running.size >= this.concurrency) break;
        const next = [...this.jobs.values()]
          .filter((j) => j.status === "QUEUED" && j.runAt <= Date.now() && !this.running.has(j.id))
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!next) break;
        this.running.add(next.id);
        void this.run(next).finally(() => {
          this.running.delete(next.id);
          void this.pump();
        });
      }
    } finally {
      this.workerActive = false;
    }
  }

  private async run(job: Job) {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      job.status = "FAILED";
      job.error = `No handler registered for job "${job.name}"`;
      log.error(job.error);
      return;
    }
    job.attempts += 1;
    job.status = "RUNNING";
    job.startedAt = Date.now();
    try {
      await (handler as Handler<unknown>)(job.payload, job as Job<unknown>);
      job.status = "SUCCEEDED";
      job.finishedAt = Date.now();
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      log.error(`job ${job.name} (${job.id}) failed on attempt ${job.attempts}`, job.error);
      if (job.attempts < job.maxAttempts) {
        job.status = "QUEUED";
        job.runAt = Date.now() + 500 * job.attempts * 2;
      } else {
        job.status = "FAILED";
        job.finishedAt = Date.now();
      }
    }
  }
}

const globalForQueue = globalThis as unknown as { nexusQueue?: JobQueue };
export const queue: JobQueue = globalForQueue.nexusQueue ?? new JobQueue();
if (process.env.NODE_ENV !== "production") globalForQueue.nexusQueue = queue;
