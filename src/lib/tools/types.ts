import type { z } from 'zod';
import type { PermissionLevel, ExecutionMode } from '@/types';

export type ToolCategory =
  | 'WEB'
  | 'DOCUMENTS'
  | 'KNOWLEDGE'
  | 'PROJECTS'
  | 'TASKS'
  | 'FILES'
  | 'CALENDAR'
  | 'EMAIL'
  | 'GITHUB'
  | 'DATA_ANALYSIS'
  | 'ARTIFACT_GENERATION';

export const TOOL_CATEGORIES: ToolCategory[] = [
  'WEB', 'DOCUMENTS', 'KNOWLEDGE', 'PROJECTS', 'TASKS', 'FILES',
  'CALENDAR', 'EMAIL', 'GITHUB', 'DATA_ANALYSIS', 'ARTIFACT_GENERATION',
];

export interface ToolContext {
  userId: string;
  workspaceId: string;
  projectId?: string | null;
  runId?: string | null;
  intentId?: string | null;
  agentKey?: string | null;
  mode: ExecutionMode;
  /** Push a human-readable progress event into the run timeline. */
  emit?: (label: string, detail?: string) => void | Promise<void>;
}

export interface ToolBlocked {
  blocked: true;
  reason: string;
  requiresIntegration?: string;
}

export function blocked(reason: string, requiresIntegration?: string): ToolBlocked {
  return { blocked: true, reason, requiresIntegration };
}

export type ToolHandlerResult = unknown | ToolBlocked;

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ToolDefinition<A = any> {
  key: string;
  name: string;
  description: string;
  category: ToolCategory;
  schema: z.ZodType<A>;
  permission: PermissionLevel;
  /** Integration key that must be connected for this tool to run. */
  requiresIntegration?: string;
  timeoutMs?: number;
  maxRetries?: number;
  enabled?: boolean;
  handler: (args: A, ctx: ToolContext) => Promise<ToolHandlerResult>;
}

export type AnyTool = ToolDefinition<any>;

export interface ToolDescriptor {
  key: string;
  name: string;
  description: string;
  category: ToolCategory;
  permission: PermissionLevel;
  requiresIntegration?: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
}
