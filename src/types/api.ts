export type RunStatus =
  | "QUEUED"
  | "PLANNING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "PARTIAL";

export type IntentSummary = {
  id: string;
  rawInput: string;
  objective: string;
  desiredOutcome: string;
  entities: Array<{ type: string; name: string; id?: string }>;
  constraints: string[];
  deadlineText: string | null;
  deadline: string | null;
  capabilities: string[];
  riskLevel: string;
  permissions: string[];
  status: string;
  confidence: number;
  createdAt: string;
  completedAt: string | null;
  project: { id: string; name: string; health: string; progress: number; targetDate: string | null } | null;
};

export type AgentRunSummary = {
  id: string;
  key: string;
  name: string;
  status: RunStatus;
  step: string | null;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  latencyMs: number | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  error: string | null;
  outputs: Record<string, unknown> | null;
  children?: AgentRunSummary[];
  events?: RunEventSummary[];
};

export type RunEventSummary = {
  id: string;
  runId: string | null;
  intentId: string | null;
  kind: string;
  message: string;
  detail: Record<string, unknown> | null;
  at: string;
};

export type ApprovalSummary = {
  id: string;
  runId: string | null;
  toolKey: string;
  title: string;
  whatHappens: string;
  whyNeeded: string;
  affectedData: Record<string, unknown>;
  permissionLevel: "READ" | "WRITE" | "EXTERNAL_ACTION" | "HIGH_IMPACT";
  status: "PENDING" | "APPROVED" | "DENIED" | "MODIFIED" | "EXPIRED";
  createdAt: string;
  decidedAt: string | null;
};

export type ToolExecutionSummary = {
  id: string;
  runId: string | null;
  toolKey: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  permissionLevel: string;
  durationMs: number | null;
  createdAt: string;
};

export type ArtifactSummary = {
  id: string;
  title: string;
  type: string;
  summary: string | null;
  format: string;
  bytes: number;
  createdAt: string;
  projectId: string | null;
};

export type RunResult = {
  headline: string;
  summary: string;
  tasks: { total: number; open: number; completed: number; scheduled: number; created: number; titles: string[] };
  recommendations: Array<{ title: string; detail: string; severity: string }>;
  approvals: { total: number; pending: number; approved: number; denied: number };
  findings: Array<{ claim: string; confidence: number; source: string }>;
  checks: Array<{ name: string; status: string; detail: string }>;
  artifacts: Array<{ id: string; title: string; type: string }>;
  memories: string[];
  toolCalls: number;
  agentRuns: number;
  durationMs: number;
  demoMode: boolean;
};

export type IntentState = {
  intent: IntentSummary;
  runs: AgentRunSummary[];
  approvals: ApprovalSummary[];
  executions: ToolExecutionSummary[];
  artifacts: ArtifactSummary[];
  result: RunResult | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  objective: string | null;
  status: string;
  health: string;
  healthReason: string | null;
  progress: number;
  color: string;
  targetDate: string | null;
  updatedAt: string;
  counts: { tasks: number; documents: number; done: number };
};

export type TaskSummary = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  source: string;
  createdByAgent: string | null;
  blockedReason: string | null;
  projectId: string | null;
  project?: { id: string; name: string; color: string } | null;
  assignee?: { id: string; name: string } | null;
};

export type AgentSummary = {
  id: string;
  key: string;
  name: string;
  description: string;
  capabilities: string[];
  allowedTools: string[];
  permissionLevel: string;
  status: string;
  model: string;
  totalRuns: number;
  successRuns: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  totalTokens: number;
  totalCostUsd: number;
  lastRunAt: string | null;
};

export type ActivitySummary = {
  id: string;
  kind: string;
  action: string;
  summary: string;
  status: string;
  createdAt: string;
  detail: Record<string, unknown> | null;
  user?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
};
