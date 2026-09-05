/** Notification engine (§23). */

import { prisma } from '../../lib/db';

export type NotificationType =
  | 'APPROVAL_REQUIRED' | 'WORKFLOW_COMPLETED' | 'AGENT_COMPLETED' | 'AGENT_FAILED'
  | 'DEADLINE' | 'PROJECT_RISK' | 'INTEGRATION_ERROR' | 'MEMORY';

export async function notify(input: {
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  severity?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      severity: input.severity ?? 'INFO',
      actionUrl: input.actionUrl ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  });
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, read: false } });
}
