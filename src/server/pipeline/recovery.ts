import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { syncToolsToDb } from "@/lib/tools/registry";
import { syncAgentsToDb } from "@/lib/agents/registry";
import { queue } from "@/lib/jobs/queue";
import "./run-service";

let bootstrapped = false;

/**
 * Idempotent startup hook: registry ↔ database sync, recovery of runs that were
 * interrupted by a restart, and observability of anything left dangling.
 */
export async function bootstrapServer() {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    const workspaces = await prisma.workspace.findMany({ select: { id: true } });
    for (const ws of workspaces) {
      await syncToolsToDb(ws.id);
      await syncAgentsToDb(ws.id);
    }

    const stale = await prisma.agentRun.findMany({
      where: { key: "orchestrator", status: { in: ["RUNNING", "QUEUED"] }, startedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      select: { id: true, workspaceId: true, intentId: true, userId: true },
    });

    for (const run of stale) {
      log.warn(`recovering stale run ${run.id}`);
      await prisma.agentRun.update({
        where: { id: run.id },
        data: { status: "FAILED", error: "Interrupted by a server restart", completedAt: new Date() },
      });
      if (run.intentId) {
        await prisma.intent.update({ where: { id: run.intentId }, data: { status: "FAILED", error: "Interrupted by a server restart" } });
      }
    }

    log.info(`bootstrap complete: ${workspaces.length} workspace(s), ${stale.length} stale run(s) recovered`);
  } catch (err) {
    log.error("bootstrap failed", err);
  }
}
