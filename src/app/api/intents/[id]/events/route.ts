import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-Sent Events timeline for a run.
 * Polls persisted RunEvent rows and streams only what is new — the UI animates
 * from real state transitions, never from a canned script.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const encoder = new TextEncoder();
  let cursor = 0;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      req.signal.addEventListener('abort', () => { closed = true; });

      const startedAt = Date.now();
      while (!closed && Date.now() - startedAt < 5 * 60 * 1000) {
        const [events, intent, runs] = await Promise.all([
          prisma.runEvent.findMany({
            where: { intentId: id },
            orderBy: { createdAt: 'asc' },
            skip: cursor,
          }),
          prisma.intent.findUnique({ where: { id }, select: { status: true } }),
          prisma.agentRun.findMany({
            where: { intentId: id },
            select: { id: true, status: true, agent: { select: { key: true } }, durationMs: true },
          }),
        ]);

        if (events.length) {
          cursor += events.length;
          for (const event of events) send({ type: 'event', event });
        }

        send({ type: 'state', intentStatus: intent?.status ?? 'RECEIVED', runs });

        if (intent?.status === 'COMPLETED' || intent?.status === 'FAILED' || intent?.status === 'CANCELLED') {
          send({ type: 'done', status: intent.status });
          break;
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
