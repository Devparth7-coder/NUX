import type { Capability, ContextBundle, ExecutionPlan, IntentObject, PermissionLevel } from '@/types';
import type { AICompletionRequest, AICompletionResponse } from '../ai/types';
import type { MemoryCandidate } from '../memory/service';

export type AgentCategory = 'PLANNING' | 'RESEARCH' | 'EXECUTION' | 'KNOWLEDGE' | 'REVIEW' | 'CREATIVE' | 'ANALYSIS';

export type AgentStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'DISABLED' | 'ERROR';

export interface ToolOutcome {
  toolKey: string;
  status: 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'DENIED';
  result?: unknown;
  error?: string;
  executionId?: string;
  durationMs?: number;
  permission: PermissionLevel;
  approvalId?: string;
  requiresApproval?: boolean;
}

export interface AgentArtifact {
  title: string;
  type: 'DOCUMENT' | 'REPORT' | 'RESEARCH_SUMMARY' | 'PLAN' | 'PRESENTATION' | 'TABLE' | 'ANALYSIS';
  content: string;
  format: 'markdown' | 'json' | 'text' | 'html';
}

export interface AgentContext {
  runId: string;
  intentId: string;
  workspaceId: string;
  userId: string;
  projectId: string | null;
  intent: IntentObject;
  rawInput: string;
  context: ContextBundle;
  plan: ExecutionPlan | null;
  /** Outputs of agents that already ran, keyed by agent key. */
  prior: Record<string, AgentOutput>;
  /** Permission- and approval-gated tool invocation. */
  callTool: (toolKey: string, args: unknown) => Promise<ToolOutcome>;
  /** Append an event to the run timeline. */
  emit: (label: string, detail?: string, status?: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'WAITING') => Promise<void>;
  writeMemory: (candidate: MemoryCandidate) => Promise<void>;
  ai: (request: Partial<AICompletionRequest> & { task: AICompletionRequest['task']; variables?: Record<string, unknown> }) => Promise<AICompletionResponse>;
  mode: 'REAL' | 'DEMO';
}

export interface AgentOutput {
  agentKey: string;
  summary: string;
  data: Record<string, unknown>;
  artifacts: AgentArtifact[];
  toolCalls: number;
  tokens: number;
  recommendations?: string[];
}

export interface AgentDefinition {
  key: string;
  name: string;
  description: string;
  category: AgentCategory;
  capabilities: Capability[];
  allowedTools: string[];
  permissionLevel: PermissionLevel;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  icon: string;
  execute: (ctx: AgentContext) => Promise<AgentOutput>;
}
