import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { providerHealth, providerInfo } from "@/lib/ai";
import { queue } from "@/lib/jobs/queue";
import { storage } from "@/lib/storage";

export const GET = route({ auth: false, rateLimit: { limit: 60, windowMs: 60_000 } }, async () => {
  const started = Date.now();
  let database: { ok: boolean; latencyMs: number; detail?: string } = { ok: false, latencyMs: 0 };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    database = { ok: false, latencyMs: Date.now() - started, detail: String(err) };
  }

  const ai = await providerHealth();
  return ok({
    status: database.ok ? "operational" : "degraded",
    database,
    ai: { ...ai, ...providerInfo() },
    storage: storage().describe(),
    queue: queue.stats(),
    timestamp: new Date().toISOString(),
  });
});
