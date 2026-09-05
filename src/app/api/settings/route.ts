import { z } from "zod";
import { prisma } from "@/lib/db";
import { route, ok } from "@/lib/api";
import { providerInfo, providerHealth } from "@/lib/ai";
import { storage } from "@/lib/storage";
import { SERVER_ENV } from "@/lib/env";

export const GET = route({ auth: true }, async (_req, ctx) => {
  const [user, prefs, notifPrefs, integrations] = await Promise.all([
    prisma.user.findUnique({ where: { id: ctx.auth.userId }, select: { id: true, name: true, email: true, avatarUrl: true, createdAt: true } }),
    prisma.userPreference.findUnique({ where: { userId: ctx.auth.userId } }),
    prisma.notificationPrefs.findUnique({ where: { userId: ctx.auth.userId } }),
    prisma.integration.findMany({ where: { workspaceId: ctx.auth.workspaceId }, select: { kind: true, status: true } }),
  ]);
  return ok({
    user,
    preferences: prefs ?? { theme: "dark", density: "comfortable", reducedMotion: false, autoApproveRead: true },
    notificationPrefs: notifPrefs ?? {},
    ai: { ...providerInfo(), health: await providerHealth() },
    storage: storage().describe(),
    runtime: SERVER_ENV,
    integrations,
  });
});

const Patch = z.object({
  name: z.string().min(2).max(80).nullish(),
  theme: z.enum(["dark", "light", "system"]).nullish(),
  density: z.enum(["comfortable", "compact"]).nullish(),
  reducedMotion: z.boolean().nullish(),
  autoApproveRead: z.boolean().nullish(),
  defaultProjectId: z.string().nullish(),
  notifications: z
    .object({
      approvalRequired: z.boolean().nullish(),
      runCompleted: z.boolean().nullish(),
      runFailed: z.boolean().nullish(),
      deadlineApproaching: z.boolean().nullish(),
      projectAtRisk: z.boolean().nullish(),
      integrationError: z.boolean().nullish(),
      emailDigest: z.boolean().nullish(),
    })
    .nullish(),
});

export const PATCH = route<typeof Patch>({ body: Patch }, async (_req, ctx, input) => {
  if (input.body.name) {
    await prisma.user.update({ where: { id: ctx.auth.userId }, data: { name: input.body.name } });
  }
  const prefs = await prisma.userPreference.upsert({
    where: { userId: ctx.auth.userId },
    update: {
      theme: input.body.theme ?? undefined,
      density: input.body.density ?? undefined,
      reducedMotion: input.body.reducedMotion ?? undefined,
      autoApproveRead: input.body.autoApproveRead ?? undefined,
      defaultProjectId: input.body.defaultProjectId ?? undefined,
    },
    create: {
      userId: ctx.auth.userId,
      theme: input.body.theme ?? "dark",
      density: input.body.density ?? "comfortable",
      reducedMotion: input.body.reducedMotion ?? false,
      autoApproveRead: input.body.autoApproveRead ?? true,
      defaultProjectId: input.body.defaultProjectId ?? null,
    },
  });

  let notifPrefs = null;
  if (input.body.notifications) {
    notifPrefs = await prisma.notificationPrefs.upsert({
      where: { userId: ctx.auth.userId },
      update: input.body.notifications as never,
      create: { userId: ctx.auth.userId, ...(input.body.notifications as object) } as never,
    });
  }

  return ok({ preferences: prefs, notificationPrefs: notifPrefs });
});
