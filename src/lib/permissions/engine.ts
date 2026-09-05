import type { PermissionLevel } from "@prisma/client";

export const PERMISSION_ORDER: Record<PermissionLevel, number> = {
  READ: 0,
  WRITE: 1,
  EXTERNAL_ACTION: 2,
  HIGH_IMPACT: 3,
};

export type PermissionDecision = {
  level: PermissionLevel;
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
};

export const PERMISSION_COPY: Record<PermissionLevel, { label: string; description: string; tone: "neutral" | "warn" | "danger" }> = {
  READ: { label: "READ", description: "Reading workspace data. No side effects.", tone: "neutral" },
  WRITE: { label: "WRITE", description: "Creates or updates workspace records.", tone: "warn" },
  EXTERNAL_ACTION: {
    label: "EXTERNAL",
    description: "Reaches an external system. Can be visible outside your workspace.",
    tone: "danger",
  },
  HIGH_IMPACT: {
    label: "HIGH IMPACT",
    description: "Destructive or irreversible. Always requires explicit approval.",
    tone: "danger",
  },
};

/**
 * Central permission gate. The orchestrator consults this before every tool call.
 * Auto-approval is granular: READ may be auto-approved by preference, everything
 * else stops the run and creates an Approval row.
 */
export function evaluatePermission(
  level: PermissionLevel,
  opts: { autoApproveRead: boolean; integrationStatus?: "CONNECTED" | "DISCONNECTED" | "ERROR" | "NOT_CONFIGURED" },
): PermissionDecision {
  if (level === "READ") {
    return opts.autoApproveRead
      ? { level, allowed: true, requiresApproval: false, reason: "Read-only action permitted by workspace policy." }
      : { level, allowed: true, requiresApproval: true, reason: "Workspace policy requires confirmation for reads." };
  }
  if (level === "WRITE") {
    return { level, allowed: true, requiresApproval: true, reason: "Write actions are prepared and require your approval." };
  }
  if (level === "EXTERNAL_ACTION") {
    if (opts.integrationStatus && opts.integrationStatus !== "CONNECTED") {
      return {
        level,
        allowed: false,
        requiresApproval: false,
        reason: `The required integration is ${opts.integrationStatus.replace("_", " ").toLowerCase()}. Connect it in Settings → Integrations.`,
      };
    }
    return { level, allowed: true, requiresApproval: true, reason: "External actions leave your workspace and require explicit approval." };
  }
  return { level, allowed: true, requiresApproval: true, reason: "High-impact actions are destructive or irreversible and always require approval." };
}

export function highestLevel(levels: PermissionLevel[]): PermissionLevel {
  return levels.reduce<PermissionLevel>((acc, l) => (PERMISSION_ORDER[l] > PERMISSION_ORDER[acc] ? l : acc), "READ");
}

export function levelAtLeast(level: PermissionLevel, min: PermissionLevel) {
  return PERMISSION_ORDER[level] >= PERMISSION_ORDER[min];
}
