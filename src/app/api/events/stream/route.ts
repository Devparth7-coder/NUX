import { prisma } from "@/lib/db";
import { getAuthContext } from "@/lib/auth/guard";
import { bus, type NexusEvent } from "@/lib/events/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events for live execution. Replays persisted history first so a
 * client that connects late still sees the whole run, then streams new events.
 */
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const sp = new URL(req.url).searchParams;
  const runId = sp.get("runId");
  const intentId = sp.get("intentId");
  if (!runId && !intentId) return new Response("runId or intentId required", { status: 400 });

  const encoder = new TextEncoder();
  const seen = new Set<string>();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: NexusEvent) => {
        if (closed || seen.has(event.id)) return;
        seen.add(event.id);
        try {
          controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Replay persisted history (events emitted before this connection).
      const rows = await prisma.runEvent.findMany({
        where: runId ? { OR: [{ runId }, { intentId: intentId ?? undefined }] } : { intentId: intentId ?? undefined },
        orderBy: { at: "asc" },
        take: 300,
      });
      for (const row of rows) {
        send({
          id: row.id,
          channel: runId ? `run:${runId}` : `intent:${intentId}`,
          type: row.kind,
          message: row.message,
          detail: (row.detail as Record<string, unknown>) ?? {},
          at: row.at.toISOString(),
        });
      }

      const channels = [runId ? `run:${runId}` : null, intentId ? `intent:${intentId}` : null].filter(Boolean) as string[];
      const unsubs = channels.map((c) => bus.subscribe(c, send));
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubs.forEach((u) => u());
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener("abort", cleanup);
      setTimeout(cleanup, 10 * 60_000);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
