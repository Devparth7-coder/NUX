import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { runSingleAgent } from '@/lib/orchestration/single-agent';
import { getAgent } from '@/lib/agents/registry';
import { handler, ok, validationError } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 120;

const schema = z.object({ instruction: z.string().min(3).max(2000), projectId: z.string().optional().nullable() });

export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const agent = getAgent(id);
  if (!agent) throw notFound('Agent not found');

  const result = await runSingleAgent({
    agentKey: agent.key,
    instruction: parsed.data.instruction,
    userId: user.id,
    workspaceId: user.workspaceId,
    projectId: parsed.data.projectId ?? null,
  });

  return ok(result, { status: 202 });
});
