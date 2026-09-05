import { NextRequest, after } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { startRun } from '@/lib/orchestration/orchestrator';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/auth/rate-limit';
import { NexusError } from '@/lib/errors';
import { fail, handler, ok, validationError } from '@/lib/api/response';
import { recordActivity } from '@/server/services/activity';

export const runtime = 'nodejs';
export const maxDuration = 60;

const schema = z.object({
  input: z.string().min(3).max(4000),
  projectId: z.string().optional().nullable(),
  conversationId: z.string().optional().nullable(),
});

/**
 * COMMAND → INTENT → CONTEXT → PLAN → ORCHESTRATION → …
 *
 * Returns immediately with intent + run ids. Execution continues in the
 * background so a single HTTP request never owns a long-running agent.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const limit = rateLimit(`command:${user.id}`, 30, 60_000);
  if (!limit.allowed) return fail(new NexusError('RATE_LIMITED', 'Too many commands. Wait a moment.'));

  let conversationId = parsed.data.conversationId ?? null;
  if (!conversationId) {
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: user.workspaceId,
        userId: user.id,
        projectId: parsed.data.projectId ?? null,
        title: parsed.data.input.slice(0, 80),
      },
    });
    conversationId = conversation.id;
    await prisma.message.create({
      data: { conversationId, role: 'USER', content: parsed.data.input },
    });
  } else {
    await prisma.message.create({
      data: { conversationId, role: 'USER', content: parsed.data.input },
    });
  }

  const result = await startRun({
    userId: user.id,
    workspaceId: user.workspaceId,
    rawInput: parsed.data.input,
    projectId: parsed.data.projectId ?? null,
    conversationId,
    // On serverless the pipeline must outlive this response; `after()` keeps the
    // function warm until it settles (bounded by the route's maxDuration).
    schedule: (work) => after(work),
  });

  await recordActivity({
    workspaceId: user.workspaceId,
    userId: user.id,
    projectId: parsed.data.projectId ?? null,
    intentId: result.intentId,
    type: 'AGENT',
    action: 'Command received',
    summary: parsed.data.input.slice(0, 140),
    severity: 'INFO',
  });

  return ok({ ...result, conversationId }, { status: 202 });
});
