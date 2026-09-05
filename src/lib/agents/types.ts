import type { PermissionLevel } from "@prisma/client";
import type { ContextBundle } from "@/lib/retrieval/context-engine";

export type AgentKey = "planning" | "research" | "knowledge" | "execution" | "review" | "creative" | "analyst";

export type ParsedIntent = {
  objective: string;
  desiredOutcome: string;
  entities: Array<{ type: string; name: string; id?: string }>;
  constraints: string[];
  deadlineText: string | null;
  deadline: string | null;
  projectContext: { id: string; name: string } | null;
  requiredCapabilities: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  permissionsRequired: string[];
  confidence: number;
  reasoningSummary: string;
};

export type AgentOutcome =
  | "COMPLETED"
  | "WAITING_APPROVAL"
  | "FAILED"
  | "PARTIAL";

export type AgentResult = {
  status: AgentOutcome;
  summary: string;
  output: Record<string, unknown>;
  approvalIds?: string[];
  toolExecutionIds?: string[];
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  error?: string;
  errorDetail?: Record<string, unknown>;
};

export type AgentContext = {
  /** Child AgentRun row for this step. */
  runId: string;
  graphRunId: string;
  workspaceId: string;
  userId: string;
  intentId: string;
  projectId: string | null;
  intent: ParsedIntent;
  context: ContextBundle;
  /** Outputs of upstream steps, keyed by step id. */
  priorOutputs: Record<string, Record<string, unknown>>;
  /** Persisted input of this run — survives halt/resume cycles. */
  runInput: Record<string, unknown>;
  autoApproveRead: boolean;
  stepId: string;
  /** Emit a user-visible execution event (never chain-of-thought). */
  log: (message: string, detail?: Record<string, unknown>) => void;
};

export type AgentDefinition = {
  key: AgentKey;
  name: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  allowedTools: string[];
  permissionLevel: PermissionLevel;
  model: string;
  temperature: number;
  run: (ctx: AgentContext) => Promise<AgentResult>;
};

export const AGENT_ACCENT: Record<AgentKey, string> = {
  planning: "#60A5FA",
  research: "#818CF8",
  knowledge: "#34D399",
  execution: "#F59E0B",
  review: "#F472B6",
  creative: "#C084FC",
  analyst: "#22D3EE",
};
