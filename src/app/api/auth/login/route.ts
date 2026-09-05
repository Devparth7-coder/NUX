import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { requestMeta } from "@/lib/auth/guard";
import { recordAudit } from "@/server/services/activity";

const Body = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });

export const POST = route({ body: Body, auth: false, rateLimit: { limit: 12, windowMs: 60_000 } }, async (req, ctx, input) => {
  const user = await prisma.user.findUnique({ where: { email: input.body.email.toLowerCase() } });
  if (!user || !(await verifyPassword(input.body.password, user.passwordHash))) {
    await recordAudit({ workspaceId: "public", action: "auth.login_failed", entityType: "USER", detail: { email: input.body.email } });
    throw Errors.unauthorized();
  }
  const membership = await prisma.membership.findFirst({ where: { userId: user.id }, include: { workspace: true } });
  if (!membership) throw Errors.forbidden("No workspace membership for this account");

  const meta = await requestMeta();
  await createSession(user.id, membership.workspaceId, membership.role, meta.userAgent ?? undefined, meta.ip ?? undefined);
  await recordAudit({ workspaceId: membership.workspaceId, userId: user.id, action: "auth.login", entityType: "USER", entityId: user.id, ip: meta.ip });
  return ok({ user: { id: user.id, name: user.name, email: user.email }, workspace: { id: membership.workspace.id, name: membership.workspace.name } });
});
