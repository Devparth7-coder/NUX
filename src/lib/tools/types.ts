import type { PermissionLevel } from "@prisma/client";
import type { ZodTypeAny, z } from "zod";

export type ToolCategory =
  | "WEB"
  | "DOCUMENTS"
  | "KNOWLEDGE"
  | "PROJECTS"
  | "TASKS"
  | "FILES"
  | "CALENDAR"
  | "EMAIL"
  | "GITHUB"
  | "DATA_ANALYSIS"
  | "MEMORY"
  | "ARTIFACT_GENERATION";

export type IntegrationKey = "GITHUB" | "GOOGLE_DRIVE" | "GOOGLE_CALENDAR" | "GMAIL" | "SLACK" | "NOTION";

export type ToolContext = {
  workspaceId: string;
  userId: string;
  projectId?: string | null;
  runId?: string | null;
  intentId?: string | null;
  /** Set when the call is being made after a human granted approval. */
  approvalId?: string | null;
};

export type ToolHandler<I, O> = (input: I, ctx: ToolContext) => Promise<O>;

export type ToolDefinition<I extends ZodTypeAny = ZodTypeAny, O = unknown> = {
  key: string;
  name: string;
  description: string;
  category: ToolCategory;
  permissionLevel: PermissionLevel;
  inputSchema: I;
  requiresIntegration?: IntegrationKey;
  timeoutMs?: number;
  retryPolicy?: { maxAttempts: number; backoffMs: number };
  /** Human sentence describing the concrete side effect, used in approvals. */
  summarize: (input: z.infer<I>) => string;
  /** Data the action touches, surfaced in the approval dialog. */
  affectedData?: (input: z.infer<I>) => Record<string, unknown>;
  handler: ToolHandler<z.infer<I>, O>;
};
