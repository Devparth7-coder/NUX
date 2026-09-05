import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { toolRegistry } from '@/lib/tools/registry';
import { authorize, DEFAULT_POLICY } from '@/lib/permissions/engine';
import { isDemo } from '@/lib/ai';
import { recordActivity } from '@/server/services/activity';
import { NexusError } from '@/lib/errors';
import { fail, handler, ok, validationError } from '@/lib/api/response';

export const runtime = 'nodejs';

const schema = z.object({
  args: z.unknown().default({}),
  confirm: z.boolean().default(false),
});

/** Manual tool execution — same permission gate the orchestrator uses. */
export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ key: string }> }) => {
  const user = await requireUser();
  const { key } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const tool = toolRegistry.get(key);
  if (!tool) throw new NexusError('NOT_FOUND', `Unknown tool: ${key}`);

  const settings = await prisma.setting.findFirst({
    where: { userId: user.id, namespace: 'permissions', key: 'policy' },
  });
  const policy = settings ? { ...DEFAULT_POLICY, ...(JSON.parse(settings.value) as object) } : { ...DEFAULT_POLICY };

  const connected = (await prisma.integration.findMany({ where: { userId: user.id, status: 'CONNECTED' }, select: { key: true } })).map((i) => i.key);

  const decision = authorize(tool.permission, {
    roleCeiling: user.role === 'OWNER' || user.role === 'ADMIN' ? 'HIGH_IMPACT' : user.role === 'MEMBER' ? 'EXTERNAL_ACTION' : 'READ',
    policy,
    connectedIntegrations: connected,
    requiredIntegrations: tool.requiresIntegration ? [tool.requiresIntegration] : [],
    grantedApprovals: parsed.data.confirm ? [tool.permission] : [],
  });

  if (!decision.allowed) return fail(new NexusError('PERMISSION_DENIED', decision.reason, { details: { requiresApproval: decision.requiresApproval } }));

  const started = Date.now();
  const { result } = await toolRegistry.execute(key, parsed.data.args, {
    userId: user.id,
    workspaceId: user.workspaceId,
    mode: isDemo() ? 'DEMO' : 'REAL',
  });

  await recordActivity({
    workspaceId: user.workspaceId,
    userId: user.id,
    type: 'TOOL',
    action: `Tool executed: ${key}`,
    summary: JSON.stringify(result).slice(0, 200),
    severity: 'INFO',
  });

  return ok({ tool: key, result, durationMs: Date.now() - started });
});
