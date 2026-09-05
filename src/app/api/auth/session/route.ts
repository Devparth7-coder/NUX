import { route, ok } from "@/lib/api";
import { getAuthContext } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { isDemoMode } from "@/lib/env";

export const GET = route({ auth: false }, async () => {
  const ctx = await getAuthContext();
  if (!ctx) return ok({ authenticated: false, demoMode: isDemoMode });
  const prefs = await prisma.userPreference.findUnique({ where: { userId: ctx.userId } });
  return ok({
    authenticated: true,
    demoMode: isDemoMode,
    user: ctx.user,
    workspace: ctx.workspace,
    role: ctx.role,
    preferences: prefs ?? null,
  });
});
