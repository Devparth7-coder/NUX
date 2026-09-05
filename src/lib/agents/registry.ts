import type { AgentDefinition, AgentKey } from "./types";

export type { AgentKey };
import { planningAgent } from "./planning";
import { researchAgent } from "./research";
import { knowledgeAgent } from "./knowledge";
import { executionAgent } from "./execution";
import { reviewAgent } from "./review";
import { creativeAgent } from "./creative";
import { analystAgent } from "./analyst";

export const AGENTS: Record<AgentKey, AgentDefinition> = {
  planning: planningAgent,
  research: researchAgent,
  knowledge: knowledgeAgent,
  execution: executionAgent,
  review: reviewAgent,
  creative: creativeAgent,
  analyst: analystAgent,
};

export const AGENT_LIST: AgentDefinition[] = Object.values(AGENTS);

export function getAgent(key: string): AgentDefinition | undefined {
  return AGENT_LIST.find((a) => a.key === key);
}

export async function syncAgentsToDb(workspaceId: string) {
  const { prisma } = await import("@/lib/db");
  for (const agent of AGENT_LIST) {
    const data = {
      workspaceId,
      key: agent.key,
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      capabilities: agent.capabilities,
      allowedTools: agent.allowedTools,
      permissionLevel: agent.permissionLevel,
      model: agent.model,
      temperature: agent.temperature,
    };
    await prisma.agent.upsert({
      where: { workspaceId_key: { workspaceId, key: agent.key } },
      update: data,
      create: data,
    });
  }
  return AGENT_LIST.length;
}
