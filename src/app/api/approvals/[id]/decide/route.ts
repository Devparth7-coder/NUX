import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { decideApproval } from "@/server/pipeline/approval-service";
import { requestMeta } from "@/lib/auth/guard";

type Params = { id: string };

const Body = z.object({
  decision: z.enum(["APPROVED", "DENIED", "MODIFIED"]),
  note: z.string().max(500).nullish(),
  modifiedInput: z.record(z.unknown()).nullish(),
});

export const POST = route<typeof Body, undefined, Params>({ body: Body }, async (_req, ctx, input) => {
  const { id } = await ctx.params;
  const approval = await prisma.approval.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!approval) throw Errors.notFound("Approval");
  const meta = await requestMeta();
  const updated = await decideApproval({
    approvalId: approval.id,
    userId: ctx.auth.userId,
    workspaceId: ctx.auth.workspaceId,
    decision: input.body.decision,
    note: input.body.note ?? null,
    modifiedInput: input.body.modifiedInput ?? null,
    ip: meta.ip,
  });
  return ok({ approval: updated });
});
