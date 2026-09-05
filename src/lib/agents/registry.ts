/**
 * Agent registry (§10). Agents are discovered from here by the orchestrator,
 * persisted into the `Agent` table on boot, and surfaced in the Agents view.
 */

import { planningAgent } from './implementations/planning';
import { researchAgent } from './implementations/research';
import { knowledgeAgent } from './implementations/knowledge';
import { executionAgent } from './implementations/execution';
import { reviewAgent } from './implementations/review';
import { creativeAgent } from './implementations/creative';
import { analystAgent } from './implementations/analyst';
import type { AgentDefinition } from './types';

export const AGENTS: AgentDefinition[] = [
  planningAgent,
  researchAgent,
  knowledgeAgent,
  executionAgent,
  reviewAgent,
  creativeAgent,
  analystAgent,
];

const byKey = new Map(AGENTS.map((a) => [a.key, a]));

export function getAgent(key: string): AgentDefinition | undefined {
  return byKey.get(key);
}

export function requireAgent(key: string): AgentDefinition {
  const agent = byKey.get(key);
  if (!agent) throw new Error(`Unknown agent: ${key}`);
  return agent;
}

export function listAgents(): AgentDefinition[] {
  return AGENTS;
}

/** Which agents can satisfy a capability set — used for dynamic selection. */
export function agentsForCapabilities(capabilities: string[]): AgentDefinition[] {
  const wanted = new Set(capabilities);
  return AGENTS.filter((a) => a.capabilities.some((c) => wanted.has(c)));
}

export type { AgentDefinition, AgentContext, AgentOutput, ToolOutcome } from './types';
