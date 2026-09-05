import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/server/auth/guard';
import { resolveApproval } from '@/lib/orchestration/approvals';
import { recordActivity, audit } from '@/server/services/activity';
import { handler, ok, validationError } from '@/lib/api/response';
import { notFound } from '@/lib/errors';

export const runtime = 'nodejs';

const schema = z.object({
  decision: z.enum(['APPROVED', 'DENIED', 'MODIFIED']),
  note: z.string().max(1000).optional(),
  modifiedArgs: z.unknown().optional(),
});

/**
 * The single place where a human authorises a sensitive action.
 * Recording the decision and releasing the gate are separate steps: the database
 * is the source of truth, the in-process gate simply unblocks the awaiting run.
 */
export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const approval = await prisma.approval.findFirst({
    where: { id, OR: [{ requestedById: user.id }, { intent: { userId: user.id } }] },
  });
  if (!approval) throw notFound('Approval not found');
  if (approval.status !== 'PENDING') {
    return ok({ approval, alreadyDecided: true });
  }

  const now = new Date();
  const updated = await prisma.approval.update({
    where: { id },
    data: {
      status: parsed.data.decision,
      decidedById: user.id,
      decisionNote: parsed.data.note ?? null,
      decidedAt: now,
    },
  });

  const released = resolveApproval(id, {
    decision: parsed.data.decision,
    note: parsed.data.note,
    modifiedArgs: parsed.data.modifiedArgs,
  });

  await recordActivity({
    workspaceId: approval.workspaceId,
    userId: user.id,
    projectId: approval.projectId,
    intentId: approval.intentId,
    approvalId: approval.id,
    type: 'APPROVAL',
    action: `Approval ${parsed.data.decision.toLowerCase()}`,
    summary: `${approval.toolKey ?? approval.title} — ${parsed.data.decision}${parsed.data.note ? ` · ${parsed.data.note}` : ''}`,
    severity: parsed.data.decision === 'DENIED' ? 'WARNING' : 'SUCCESS',
  });

  await audit({
    userId: user.id,
    action: `approval.${parsed.data.decision.toLowerCase()}`,
    entityType: 'APPROVAL',
    entityId: approval.id,
    metadata: { toolKey: approval.toolKey, permission: approval.permission },
  });

  return ok({ approval: updated, released, note: parsed.data.note ?? null });
});
