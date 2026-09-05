import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { listTools } from "@/lib/tools/registry";
import "@/lib/tools";

export const GET = route({ auth: true }, async (_req, ctx) => {
  const integrations = await prisma.integration.findMany({ where: { workspaceId: ctx.auth.workspaceId } });
  const tools = listTools();
  return ok({
    // `credentials` is deliberately excluded from the projection below.
    integrations: integrations.map((i) => ({
      id: i.id,
      kind: i.kind,
      status: i.status,
      accountLabel: i.accountLabel,
      scopes: i.scopes,
      lastSyncedAt: i.lastSyncedAt,
      lastError: i.lastError,
      connected: i.status === "CONNECTED",
      toolsAvailable: tools.filter((t) => t.requiresIntegration === i.kind).map((t) => t.key),
    })),
  });
});
