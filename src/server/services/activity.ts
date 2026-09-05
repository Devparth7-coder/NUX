import type { ActivityKind, Prisma, ProjectHealth } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bus } from "@/lib/events/bus";

export async function recordActivity(args: {
  workspaceId: string;
  userId?: string | null;
  projectId?: string | null;
  kind: ActivityKind;
  action: string;
  summary: string;
  detail?: Prisma.InputJsonValue;
  entityType?: string;
  entityId?: string;
  status?: "info" | "success" | "warning" | "error";
  intentId?: string | null;
}) {
  const activity = await prisma.activity.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.userId ?? null,
      projectId: args.projectId ?? null,
      intentId: args.intentId ?? null,
      kind: args.kind,
      action: args.action,
      summary: args.summary,
      detail: args.detail ?? {},
      entityType: args.entityType ?? null,
      entityId: args.entityId ?? null,
      status: args.status ?? "info",
    },
  });
  bus.publish(`workspace:${args.workspaceId}`, "activity.created", args.summary, { activityId: activity.id, kind: args.kind });
  return activity;
}

export async function recordAudit(args: {
  workspaceId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  detail?: Prisma.InputJsonValue;
  ip?: string | null;
}) {
  return prisma.auditLog.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.userId ?? null,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId ?? null,
      detail: args.detail ?? {},
      ip: args.ip ?? null,
    },
  });
}

export async function notify(args: {
  workspaceId: string;
  userId: string;
  kind: "APPROVAL_REQUIRED" | "RUN_COMPLETED" | "RUN_FAILED" | "DEADLINE_APPROACHING" | "PROJECT_AT_RISK" | "INTEGRATION_ERROR" | "MEMORY_SAVED" | "WORKFLOW_COMPLETED";
  title: string;
  body: string;
  href?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const notification = await prisma.notification.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.userId,
      kind: args.kind,
      title: args.title,
      body: args.body,
      href: args.href ?? null,
      metadata: args.metadata ?? {},
    },
  });
  bus.publish(`user:${args.userId}`, "notification.created", args.title, { notificationId: notification.id });
  return notification;
}

export function healthFromSignals(input: { overdue: number; blocked: number; progress: number; daysToDeadline: number | null }): { health: ProjectHealth; reason: string } {
  if (input.blocked > 0) return { health: "BLOCKED", reason: `${input.blocked} blocked task(s) require attention` };
  if (input.overdue > 0) return { health: "AT_RISK", reason: `${input.overdue} overdue task(s)` };
  if (input.daysToDeadline !== null && input.daysToDeadline <= 2 && input.progress < 80) {
    return { health: "AT_RISK", reason: `Deadline in ${input.daysToDeadline} day(s) with ${input.progress}% complete` };
  }
  if (input.progress >= 100) return { health: "COMPLETED", reason: "All scoped work is complete" };
  return { health: "HEALTHY", reason: "Delivery signals are nominal" };
}
