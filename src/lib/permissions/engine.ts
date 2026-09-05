/**
 * Centralised permission engine (§13).
 *
 * Every tool invocation passes through `authorize()`. Nothing executes on trust:
 * the orchestrator asks this module before each tool call, and this module is the
 * single source of truth for what needs approval.
 */

import type { PermissionLevel } from '@/types';
import { PERMISSION_RANK } from '@/types';

export type { PermissionLevel };
export { PERMISSION_RANK };

/** Workspace-configurable auto-approval policy. */
export interface PermissionPolicy {
  READ: boolean;
  WRITE: boolean;
  EXTERNAL_ACTION: boolean;
  HIGH_IMPACT: boolean;
  /** When true every write also needs explicit human sign-off. */
  requireApprovalForAll: boolean;
}

export const DEFAULT_POLICY: PermissionPolicy = {
  READ: true,
  WRITE: true,
  EXTERNAL_ACTION: false,
  HIGH_IMPACT: false,
  requireApprovalForAll: false,
};

export interface AuthorizationContext {
  /** Granted ceiling derived from the user's role. */
  roleCeiling: PermissionLevel;
  policy: PermissionPolicy;
  /** Integrations required by the tool that are actually connected. */
  connectedIntegrations: string[];
  /** Integrations the tool requires. */
  requiredIntegrations: string[];
  /** Permissions already granted by an approved Approval record for this run. */
  grantedApprovals: PermissionLevel[];
}

export type AuthorizationResult =
  | { allowed: true; requiresApproval: false; reason: string }
  | { allowed: false; requiresApproval: true; reason: string; level: PermissionLevel }
  | { allowed: false; requiresApproval: false; reason: string; level: PermissionLevel };

export function exceedsCeiling(level: PermissionLevel, ceiling: PermissionLevel): boolean {
  return PERMISSION_RANK[level] > PERMISSION_RANK[ceiling];
}

/**
 * Decide whether a tool call may proceed.
 * Order of checks: role ceiling → integration availability → policy/approval.
 */
export function authorize(level: PermissionLevel, ctx: AuthorizationContext): AuthorizationResult {
  if (ctx.policy.requireApprovalForAll && PERMISSION_RANK[level] >= PERMISSION_RANK.WRITE) {
    if (!ctx.grantedApprovals.includes(level)) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: 'This workspace requires explicit approval for all mutating actions.',
        level,
      };
    }
    return { allowed: true, requiresApproval: false, reason: 'Approved by workspace owner.' };
  }

  if (exceedsCeiling(level, ctx.roleCeiling)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Your role permits up to ${ctx.roleCeiling}, but this action requires ${level}.`,
      level,
    };
  }

  const missing = ctx.requiredIntegrations.filter((i) => !ctx.connectedIntegrations.includes(i));
  if (missing.length) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Required integration(s) not connected: ${missing.join(', ')}. Connect them in Settings → Integrations.`,
      level,
    };
  }

  if (ctx.grantedApprovals.includes(level)) {
    return { allowed: true, requiresApproval: false, reason: 'Approved explicitly for this run.' };
  }

  if (ctx.policy[level]) {
    return { allowed: true, requiresApproval: false, reason: `Auto-approved by policy for ${level}.` };
  }

  return {
    allowed: false,
    requiresApproval: true,
    reason: `${level} actions require explicit human approval.`,
    level,
  };
}

export function describePermission(level: PermissionLevel): string {
  switch (level) {
    case 'READ':
      return 'Read-only. Retrieves information without changing anything.';
    case 'WRITE':
      return 'Modifies workspace data (tasks, projects, documents, knowledge).';
    case 'EXTERNAL_ACTION':
      return 'Sends data or triggers actions in an external system.';
    case 'HIGH_IMPACT':
      return 'Irreversible or production-affecting operation.';
  }
}

export function riskForPermission(level: PermissionLevel): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (level === 'HIGH_IMPACT') return 'HIGH';
  if (level === 'EXTERNAL_ACTION') return 'HIGH';
  if (level === 'WRITE') return 'MEDIUM';
  return 'LOW';
}
