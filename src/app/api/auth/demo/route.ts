import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { Errors } from "@/lib/errors";
import { createSession } from "@/lib/auth/session";
import { requestMeta } from "@/lib/auth/guard";

const DEMO_EMAIL = "demo@nexus.ai";

/** Signs in the seeded demo account — a real session, not a UI shortcut. */
export const POST = route({ auth: false, rateLimit: { limit: 20, windowMs: 60_000 } }, async () => {
  const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) throw Errors.notFound("Demo account (run `npm run db:seed`)");
  const membership = await prisma.membership.findFirst({ where: { userId: user.id }, include: { workspace: true } });
  if (!membership) throw Errors.forbidden("Demo account has no workspace");
  const meta = await requestMeta();
  await createSession(user.id, membership.workspaceId, membership.role, meta.userAgent ?? undefined, meta.ip ?? undefined);
  return ok({ user: { id: user.id, name: user.name, email: user.email }, workspace: { id: membership.workspace.id, name: membership.workspace.name } });
});
