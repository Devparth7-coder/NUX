/**
 * NEXUS domain types.
 * Shared by the server pipeline, API layer and UI. No `any` permitted.
 */

// ── Permissions ──────────────────────────────────────────────────────────────

export type PermissionLevel = 'READ' | 'WRITE' | 'EXTERNAL_ACTION' | 'HIGH_IMPACT';

export const PERMISSION_RANK: Record<PermissionLevel, number> = {
  READ: 0,
  WRITE: 1,
  EXTERNAL_ACTION: 2,
  HIGH_IMPACT: 3,
};

// ── Intent ───────────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type Capability =
  | 'planning'
  | 'research'
  | 'execution'
  | 'knowledge_retrieval'
  | 'document_analysis'
  | 'task_management'
  | 'creative'
  | 'analysis'
  | 'review'
  | 'integration';

export interface IntentEntity {
  name: string;
  type: 'PROJECT' | 'PERSON' | 'DOCUMENT' | 'TASK' | 'CONCEPT' | 'TECHNOLOGY' | 'ORGANIZATION' | 'DATE' | 'OTHER';
  value: string;
  confidence: number;
}

export interface IntentObject {
  objective: string;
  desiredOutcome: string;
  entities: IntentEntity[];
  constraints: string[];
  deadline: Date | null;
  deadlineText: string | null;
  projectContext: string | null;
  requiredCapabilities: Capability[];
  riskLevel: RiskLevel;
  permissionsRequired: PermissionLevel[];
  confidence: number;
  /** Which parser produced this: deterministic rules or a model. */
  parser: 'rules' | 'model';
}

// ── Context ──────────────────────────────────────────────────────────────────

export type ContextSourceType =
  | 'PROJECT'
  | 'DOCUMENT'
  | 'DOCUMENT_CHUNK'
  | 'TASK'
  | 'KNOWLEDGE'
  | 'MEMORY'
  | 'CONVERSATION'
  | 'ACTIVITY'
  | 'INTEGRATION'
  | 'PREFERENCE';

export interface RetrievedContextItem {
  sourceType: ContextSourceType;
  sourceId: string;
  title: string;
  snippet: string;
  scores: {
    semantic: number;
    keyword: number;
    project: number;
    recency: number;
    entity: number;
    relevance: number;
  };
  rationale: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export interface ContextBundle {
  items: RetrievedContextItem[];
  query: string;
  confidence: number;
  sources: ContextSourceType[];
  retrievedAt: Date;
  counts: Record<string, number>;
}

// ── Execution graph ──────────────────────────────────────────────────────────

export type ExecNodeKind = 'intent' | 'context' | 'agent' | 'tool' | 'approval' | 'validation' | 'result';

export interface ExecNode {
  id: string;
  kind: ExecNodeKind;
  label: string;
  /** agent key or tool key */
  ref?: string;
  dependsOn: string[];
  parallelGroup?: number;
  metadata?: Record<string, unknown>;
}

export interface ExecEdge {
  from: string;
  to: string;
}

export interface ExecutionGraph {
  nodes: ExecNode[];
  edges: ExecEdge[];
}

export type NodeState = 'IDLE' | 'QUEUED' | 'PLANNING' | 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'SKIPPED';

// ── Plan ─────────────────────────────────────────────────────────────────────

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  agentKey: string;
  dependsOn: string[];
  permission: PermissionLevel;
  capability: Capability;
  estimatedSeconds: number;
  toolKeys: string[];
}

export interface ExecutionPlan {
  id: string;
  objective: string;
  steps: PlanStep[];
  milestones: { title: string; dueDate: Date | null; description: string }[];
  risks: { title: string; severity: RiskLevel; mitigation: string }[];
  tasks: ProposedTask[];
  graph: ExecutionGraph;
  createdAt: Date;
}

export interface ProposedTask {
  title: string;
  description: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueDate: Date | null;
  dependsOnTitles: string[];
  capability: Capability;
  rationale: string;
}

// ── Agent runs ───────────────────────────────────────────────────────────────

export type RunStatus =
  | 'QUEUED'
  | 'PLANNING'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface RunEventPayload {
  id: string;
  runId: string;
  type: 'INTENT' | 'CONTEXT' | 'PLAN' | 'AGENT' | 'TOOL' | 'APPROVAL' | 'VALIDATION' | 'RESULT' | 'MEMORY' | 'ERROR' | 'CANCEL';
  label: string;
  detail: string | null;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'WAITING';
  nodeId: string | null;
  createdAt: Date;
}

export interface ToolExecutionRecord {
  id: string;
  toolKey: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'VALIDATION_FAILED';
  permission: PermissionLevel;
  error: string | null;
  durationMs: number | null;
  attempt: number;
}

export interface ApprovalRequestPayload {
  id: string;
  title: string;
  description: string;
  whatWillHappen: string;
  whyNeeded: string;
  toolKey: string | null;
  toolArguments: Record<string, unknown>;
  affectedData: string[];
  permission: PermissionLevel;
  riskLevel: RiskLevel;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'MODIFIED' | 'EXPIRED' | 'CANCELLED';
}

// ── Structured AI response contract (§25) ────────────────────────────────────

export interface StructuredResponse {
  intent: IntentObject | null;
  context: RetrievedContextItem[];
  plan: PlanStep[];
  agents: string[];
  tools: string[];
  approvals: ApprovalRequestPayload[];
  result: Record<string, unknown>;
  memoryUpdates: { content: string; type: string; importance: number }[];
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export type ExecutionMode = 'REAL' | 'DEMO';

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
