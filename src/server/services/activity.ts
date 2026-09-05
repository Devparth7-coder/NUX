/**
 * Activity stream (§22). Every meaningful state change is appended here —
 * the Activity Center and the dashboard read from this single table.
 */

import { prisma } from '../../lib/db';

export type ActivityType =
  | 'AGENT' | 'TOOL' | 'PROJECT' | 'DOCUMENT' | 'WORKFLOW' | 'APPROVAL'
  | 'MEMORY' | 'INTEGRATION' | 'ERROR' | 'TASK' | 'SYSTEM';

export interface RecordActivityInput {
  workspaceId?: string | null;
  userId?: string | null;
  projectId?: string | null;
  intentId?: string | null;
  approvalId?: string | null;
  type: ActivityType;
  action: string;
  summary: string;
  entityType?: string | null;
  entityId?: string | null;
  severity?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  status?: string;
  metadata?: Record<string, unknown>;
}

export async function recordActivity(input: RecordActivityInput) {
  return prisma.activity.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      userId: input.userId ?? null,
      projectId: input.projectId ?? null,
      intentId: input.intentId ?? null,
      approvalId: input.approvalId ?? null,
      type: input.type,
      action: input.action,
      summary: input.summary,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      severity: input.severity ?? 'INFO',
      status: input.status ?? 'SUCCESS',
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  });
}

export async function audit(input: {
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return prisma.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  });
}
