/**
 * Approval gate.
 *
 * When a tool requires human approval, execution genuinely stops: the pipeline
 * awaits a promise that is only resolved by a decision written through the
 * approvals API. No step is skipped, no action is simulated.
 */

import { prisma } from '../db';
import { createLogger } from '../logger';

const log = createLogger('approvals');

export type ApprovalDecision = 'APPROVED' | 'DENIED' | 'MODIFIED';

interface Waiter {
  resolve: (decision: { decision: ApprovalDecision; note?: string; modifiedArgs?: unknown }) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  runId: string;
}

const waiters = new Map<string, Waiter>();
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export function waitForApproval(
  approvalId: string,
  runId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ decision: ApprovalDecision; note?: string; modifiedArgs?: unknown }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(approvalId);
      void prisma.approval
        .update({ where: { id: approvalId }, data: { status: 'EXPIRED' } })
        .catch(() => undefined);
      reject(new Error('Approval request timed out'));
    }, timeoutMs);

    waiters.set(approvalId, { resolve, reject, timer, runId });
    log.info('awaiting approval', { approvalId, runId });
  });
}

/** Called by the approvals API once the user decides. */
export function resolveApproval(
  approvalId: string,
  decision: { decision: ApprovalDecision; note?: string; modifiedArgs?: unknown },
): boolean {
  const waiter = waiters.get(approvalId);
  if (!waiter) return false;
  clearTimeout(waiter.timer);
  waiters.delete(approvalId);
  waiter.resolve(decision);
  return true;
}

export function pendingApprovalIds(): string[] {
  return [...waiters.keys()];
}

export function cancelApprovalsForRun(runId: string): void {
  for (const [id, waiter] of waiters) {
    if (waiter.runId === runId) {
      clearTimeout(waiter.timer);
      waiters.delete(id);
      waiter.reject(new Error('Run cancelled'));
    }
  }
}
