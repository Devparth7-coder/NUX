import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { encryptSecret } from "@/lib/integrations/crypto";
import { recordActivity, recordAudit } from "@/server/services/activity";
import { requestMeta } from "@/lib/auth/guard";

type Params = { id: string };

const Patch = z.object({
  action: z.enum(["connect", "disconnect"]),
  accountLabel: z.string().max(120).nullish(),
  token: z.string().min(4).max(2000).nullish(),
  scopes: z.array(z.string()).default([]),
});

export const PATCH = route<typeof Patch, undefined, Params>({ body: Patch }, async (_req, ctx, input) => {
  const { id } = await ctx.params;
  const integration = await prisma.integration.findFirst({ where: { id, workspaceId: ctx.auth.workspaceId } });
  if (!integration) throw Errors.notFound("Integration");
  const meta = await requestMeta();

  if (input.body.action === "disconnect") {
    const updated = await prisma.integration.update({
      where: { id: integration.id },
      data: { status: "DISCONNECTED", credentials: null, accountLabel: null, scopes: [], lastError: null },
    });
    await recordAudit({ workspaceId: ctx.auth.workspaceId, userId: ctx.auth.userId, action: "integration.disconnect", entityType: "INTEGRATION", entityId: integration.id, ip: meta.ip });
    await recordActivity({
      workspaceId: ctx.auth.workspaceId,
      userId: ctx.auth.userId,
      kind: "INTEGRATION",
      action: "integration.disconnect",
      summary: `Disconnected ${integration.kind}`,
      entityType: "INTEGRATION",
      entityId: integration.id,
      status: "warning",
    });
    return ok({ integration: { ...updated, credentials: undefined } });
  }

  if (!input.body.token) throw Errors.validation({ message: "A token is required to connect this integration" });

  const updated = await prisma.integration.update({
    where: { id: integration.id },
    data: {
      status: "CONNECTED",
      credentials: encryptSecret(input.body.token),
      accountLabel: input.body.accountLabel ?? integration.accountLabel,
      scopes: input.body.scopes,
      lastSyncedAt: new Date(),
      lastError: null,
    },
  });
  await recordAudit({ workspaceId: ctx.auth.workspaceId, userId: ctx.auth.userId, action: "integration.connect", entityType: "INTEGRATION", entityId: integration.id, ip: meta.ip });
  await recordActivity({
    workspaceId: ctx.auth.workspaceId,
    userId: ctx.auth.userId,
    kind: "INTEGRATION",
    action: "integration.connect",
    summary: `Connected ${integration.kind}`,
    entityType: "INTEGRATION",
    entityId: integration.id,
    status: "success",
  });
  return ok({ integration: { ...updated, credentials: undefined } });
});
