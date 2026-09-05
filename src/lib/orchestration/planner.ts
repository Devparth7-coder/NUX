/**
 * Planning engine.
 *
 * Decomposes an intent into milestones, tasks, dependencies, risks and an
 * execution graph. Deterministic: the same intent + workspace state always
 * produces the same plan. Deadlines are distributed backwards from the target
 * date; existing tasks are matched rather than duplicated.
 */

import type { Capability, ExecutionGraph, ExecutionPlan, IntentObject, ProposedTask, RiskLevel } from '@/types';

export interface WorkspaceTaskRef {
  id: string;
  title: string;
  status: string;
  deadline: Date | null;
}

export interface PlanInput {
  intent: IntentObject;
  rawInput: string;
  projectName: string | null;
  existingTasks: WorkspaceTaskRef[];
  projectHealth?: { health: string; healthScore: number; overdueTasks: number; blockedTasks: number } | null;
  now?: Date;
}

interface Workstream {
  title: (subject: string) => string;
  description: string;
  capability: Capability;
  priority: ProposedTask['priority'];
  /** Fraction of the runway consumed before this item is due (0 = first). */
  offset: number;
  dependsOn: number[];
}

const WORKSTREAMS: Record<string, Workstream[]> = {
  launch: [
    { title: (s) => `Finalise ${s} landing page`, description: 'Lock messaging, visuals and CTA on the launch surface.', capability: 'creative', priority: 'HIGH', offset: 0.3, dependsOn: [] },
    { title: (s) => `Produce ${s} launch video`, description: 'Script, record and cut the launch walkthrough.', capability: 'creative', priority: 'MEDIUM', offset: 0.5, dependsOn: [] },
    { title: (s) => `Review ${s} technical architecture`, description: 'Verify production readiness, scaling limits and failure paths.', capability: 'review', priority: 'HIGH', offset: 0.4, dependsOn: [] },
    { title: (s) => `Prepare ${s} announcement`, description: 'Draft blog post, changelog and outbound announcement.', capability: 'creative', priority: 'HIGH', offset: 0.7, dependsOn: [0] },
    { title: (s) => `Deploy ${s} to production`, description: 'Run the release checklist and ship the production build.', capability: 'execution', priority: 'URGENT', offset: 0.9, dependsOn: [2] },
    { title: (s) => `Validate ${s} analytics`, description: 'Confirm instrumentation, funnels and alerting fire correctly.', capability: 'analysis', priority: 'MEDIUM', offset: 1.0, dependsOn: [4] },
  ],
  prepare: [
    { title: (s) => `Gather source material for ${s}`, description: 'Collect the documents and knowledge needed.', capability: 'knowledge_retrieval', priority: 'HIGH', offset: 0.25, dependsOn: [] },
    { title: (s) => `Structure ${s}`, description: 'Define sections, narrative and required evidence.', capability: 'planning', priority: 'HIGH', offset: 0.45, dependsOn: [0] },
    { title: (s) => `Draft ${s}`, description: 'Write the first complete version.', capability: 'creative', priority: 'HIGH', offset: 0.75, dependsOn: [1] },
    { title: (s) => `Review and finalise ${s}`, description: 'Quality check, consistency pass, sign-off.', capability: 'review', priority: 'MEDIUM', offset: 1, dependsOn: [2] },
  ],
  research: [
    { title: (s) => `Define research questions for ${s}`, description: 'Scope what must be answered and why.', capability: 'planning', priority: 'HIGH', offset: 0.2, dependsOn: [] },
    { title: (s) => `Collect sources on ${s}`, description: 'Gather primary sources and internal documents.', capability: 'research', priority: 'HIGH', offset: 0.5, dependsOn: [0] },
    { title: (s) => `Compare findings on ${s}`, description: 'Cross-check claims, note contradictions and gaps.', capability: 'analysis', priority: 'MEDIUM', offset: 0.75, dependsOn: [1] },
    { title: (s) => `Summarise ${s}`, description: 'Produce an evidence-linked summary.', capability: 'creative', priority: 'MEDIUM', offset: 1, dependsOn: [2] },
  ],
  analyze: [
    { title: (s) => `Collect data for ${s}`, description: 'Pull the records and documents in scope.', capability: 'knowledge_retrieval', priority: 'HIGH', offset: 0.3, dependsOn: [] },
    { title: (s) => `Compute metrics for ${s}`, description: 'Derive counts, rates and comparisons.', capability: 'analysis', priority: 'HIGH', offset: 0.6, dependsOn: [0] },
    { title: (s) => `Interpret findings for ${s}`, description: 'Turn numbers into decisions and risks.', capability: 'analysis', priority: 'MEDIUM', offset: 1, dependsOn: [1] },
  ],
  review: [
    { title: (s) => `Assemble review scope for ${s}`, description: 'List what is being reviewed and the criteria.', capability: 'knowledge_retrieval', priority: 'MEDIUM', offset: 0.3, dependsOn: [] },
    { title: (s) => `Inspect ${s}`, description: 'Work through the criteria against real artefacts.', capability: 'review', priority: 'HIGH', offset: 0.7, dependsOn: [0] },
    { title: (s) => `Report findings for ${s}`, description: 'Rank issues and recommend fixes.', capability: 'review', priority: 'MEDIUM', offset: 1, dependsOn: [1] },
  ],
  plan: [
    { title: (s) => `Clarify objective for ${s}`, description: 'Pin down the outcome and constraints.', capability: 'planning', priority: 'HIGH', offset: 0.2, dependsOn: [] },
    { title: (s) => `Sequence milestones for ${s}`, description: 'Order work by dependency and risk.', capability: 'planning', priority: 'HIGH', offset: 0.5, dependsOn: [0] },
    { title: (s) => `Assign ownership for ${s}`, description: 'Make every milestone owned and dated.', capability: 'execution', priority: 'MEDIUM', offset: 0.8, dependsOn: [1] },
    { title: (s) => `Set review checkpoints for ${s}`, description: 'Add checkpoints before irreversible steps.', capability: 'review', priority: 'MEDIUM', offset: 1, dependsOn: [2] },
  ],
  monitor: [
    { title: (s) => `Define signals for ${s}`, description: 'Choose what to watch and the thresholds.', capability: 'analysis', priority: 'MEDIUM', offset: 0.3, dependsOn: [] },
    { title: (s) => `Instrument ${s}`, description: 'Wire the signals into a trackable view.', capability: 'execution', priority: 'MEDIUM', offset: 0.7, dependsOn: [0] },
    { title: (s) => `Establish review cadence for ${s}`, description: 'Schedule when NEXUS reports changes.', capability: 'planning', priority: 'LOW', offset: 1, dependsOn: [1] },
  ],
  find: [
    { title: (s) => `Search the workspace for ${s}`, description: 'Run hybrid retrieval across all sources.', capability: 'knowledge_retrieval', priority: 'HIGH', offset: 0.5, dependsOn: [] },
    { title: (s) => `Consolidate ${s}`, description: 'Group findings by source and recency.', capability: 'analysis', priority: 'MEDIUM', offset: 1, dependsOn: [0] },
  ],
  execute: [
    { title: (s) => `Pre-flight checks for ${s}`, description: 'Confirm prerequisites before acting.', capability: 'review', priority: 'HIGH', offset: 0.25, dependsOn: [] },
    { title: (s) => `Execute ${s}`, description: 'Perform the action against the target system.', capability: 'execution', priority: 'URGENT', offset: 0.7, dependsOn: [0] },
    { title: (s) => `Verify ${s}`, description: 'Confirm the outcome matches the intent.', capability: 'review', priority: 'HIGH', offset: 1, dependsOn: [1] },
  ],
};

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3);
}

/** Jaccard-ish overlap used to avoid duplicating work the user already has. */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(1, Math.min(ta.size, tb.size));
}

/**
 * Which workstream template fits this objective?
 * The objective may or may not begin with the verb ("NEXUS launch" vs
 * "launch NEXUS"), so the whole phrase is scanned in priority order.
 */
const KEY_PRIORITY = ['launch', 'execute', 'research', 'analyze', 'analyse', 'review', 'plan', 'monitor', 'find', 'prepare'];

function objectiveKey(intent: IntentObject): string {
  const text = intent.objective.toLowerCase();
  for (const key of KEY_PRIORITY) {
    if (new RegExp(`\\b${key}\\b`).test(text)) return key === 'analyse' ? 'analyze' : key;
  }
  return 'prepare';
}

export function buildPlan(input: PlanInput): ExecutionPlan {
  const now = input.now ?? new Date();
  const key = objectiveKey(input.intent);
  const subject =
    input.projectName ?? (input.intent.objective || input.rawInput.slice(0, 60));
  const streams = WORKSTREAMS[key] ?? WORKSTREAMS.prepare!;

  const deadline = input.intent.deadline ?? new Date(now.getTime() + 7 * 86_400_000);
  const runwayMs = Math.max(86_400_000, deadline.getTime() - now.getTime());

  const tasks: ProposedTask[] = streams.map((stream, index) => {
    const dueDate = new Date(now.getTime() + runwayMs * stream.offset);
    const title = stream.title(subject);
    const match = input.existingTasks
      .map((t) => ({ task: t, score: similarity(title, t.title) }))
      .sort((a, b) => b.score - a.score)[0];
    return {
      title,
      description: stream.description,
      priority: stream.priority,
      dueDate,
      dependsOnTitles: stream.dependsOn.map((i) => streams[i]!.title(subject)),
      capability: stream.capability,
      rationale: match && match.score > 0.6
        ? `Matches existing task "${match.task.title}" (${(match.score * 100).toFixed(0)}% overlap) — will be reconciled, not duplicated.`
        : 'Derived from the objective decomposition; no matching task exists yet.',
    };
  });

  const risks: ExecutionPlan['risks'] = [];
  const hoursToDeadline = (deadline.getTime() - now.getTime()) / 3_600_000;
  if (hoursToDeadline < 72) {
    risks.push({
      title: 'Deadline is less than 72 hours away',
      severity: 'HIGH' as RiskLevel,
      mitigation: 'Run the critical path first; defer non-blocking workstreams to post-launch.',
    });
  }
  if (input.projectHealth?.overdueTasks) {
    risks.push({
      title: `${input.projectHealth.overdueTasks} task(s) already overdue`,
      severity: 'MEDIUM' as RiskLevel,
      mitigation: 'Clear or reschedule overdue work before adding new commitments.',
    });
  }
  if (input.projectHealth?.blockedTasks) {
    risks.push({
      title: `${input.projectHealth.blockedTasks} blocked task(s)`,
      severity: 'HIGH' as RiskLevel,
      mitigation: 'Resolve blockers before sequencing dependent work.',
    });
  }
  if (input.intent.permissionsRequired.includes('EXTERNAL_ACTION')) {
    risks.push({
      title: 'External actions require approval',
      severity: 'MEDIUM' as RiskLevel,
      mitigation: 'NEXUS will pause and request approval before anything leaves the workspace.',
    });
  }

  const milestones: ExecutionPlan['milestones'] = [
    { title: 'Scope locked', description: 'Objective, constraints and deadline confirmed.', dueDate: new Date(now.getTime() + runwayMs * 0.2) },
    { title: 'Assets ready', description: 'All launch material produced and reviewed.', dueDate: new Date(now.getTime() + runwayMs * 0.7) },
    { title: 'Go-live', description: 'Release executed and verified.', dueDate: deadline },
  ];

  const graph = buildAgentGraph(input.intent);

  return {
    id: `plan_${Date.now().toString(36)}`,
    objective: input.intent.objective,
    steps: tasks.map((task, index) => ({
      id: `step_${index + 1}`,
      title: task.title,
      description: task.description,
      agentKey: agentForCapability(task.capability),
      dependsOn: streams[index]!.dependsOn.map((i) => `step_${i + 1}`),
      permission: 'WRITE' as const,
      capability: task.capability,
      estimatedSeconds: 30 + index * 5,
      toolKeys: ['tasks.create', 'tasks.update'],
    })),
    milestones,
    risks,
    tasks,
    graph,
    createdAt: now,
  };
}

export function agentForCapability(capability: Capability): string {
  switch (capability) {
    case 'research': return 'research';
    case 'knowledge_retrieval':
    case 'document_analysis': return 'knowledge';
    case 'analysis': return 'analyst';
    case 'creative': return 'creative';
    case 'review': return 'review';
    case 'execution':
    case 'integration': return 'execution';
    case 'planning':
    case 'task_management':
    default: return 'planning';
  }
}

/**
 * Agent-level execution DAG.
 * planning → (research ∥ knowledge) → (analyst ∥ creative) → execution → review
 */
export function buildAgentGraph(intent: IntentObject): ExecutionGraph {
  const caps = new Set(intent.requiredCapabilities);
  const nodes: ExecutionGraph['nodes'] = [
    { id: 'intent', kind: 'intent', label: 'Intent understood', dependsOn: [] },
    { id: 'context', kind: 'context', label: 'Context retrieved', dependsOn: ['intent'] },
    { id: 'planning', kind: 'agent', label: 'Planning Agent', ref: 'planning', dependsOn: ['context'], parallelGroup: 1 },
  ];
  const edges: ExecutionGraph['edges'] = [
    { from: 'intent', to: 'context' },
    { from: 'context', to: 'planning' },
  ];

  const parallel: string[] = [];
  if (caps.has('research') || caps.has('document_analysis') || caps.has('knowledge_retrieval')) {
    nodes.push({ id: 'research', kind: 'agent', label: 'Research Agent', ref: 'research', dependsOn: ['planning'], parallelGroup: 2 });
    nodes.push({ id: 'knowledge', kind: 'agent', label: 'Knowledge Agent', ref: 'knowledge', dependsOn: ['planning'], parallelGroup: 2 });
    edges.push({ from: 'planning', to: 'research' }, { from: 'planning', to: 'knowledge' });
    parallel.push('research', 'knowledge');
  }
  if (caps.has('analysis')) {
    nodes.push({ id: 'analyst', kind: 'agent', label: 'Analyst Agent', ref: 'analyst', dependsOn: parallel.length ? parallel : ['planning'], parallelGroup: 3 });
    for (const p of parallel.length ? parallel : ['planning']) edges.push({ from: p, to: 'analyst' });
  }
  if (caps.has('creative')) {
    nodes.push({ id: 'creative', kind: 'agent', label: 'Creative Agent', ref: 'creative', dependsOn: parallel.length ? parallel : ['planning'], parallelGroup: 3 });
    for (const p of parallel.length ? parallel : ['planning']) edges.push({ from: p, to: 'creative' });
  }

  const executionDeps = [
    ...(parallel.length ? parallel : []),
    ...(caps.has('analysis') ? ['analyst'] : []),
    ...(caps.has('creative') ? ['creative'] : []),
  ];
  if (!executionDeps.length) executionDeps.push('planning');

  nodes.push({ id: 'execution', kind: 'agent', label: 'Execution Agent', ref: 'execution', dependsOn: executionDeps, parallelGroup: 4 });
  for (const d of executionDeps) edges.push({ from: d, to: 'execution' });

  nodes.push({ id: 'approval', kind: 'approval', label: 'Approval gate', dependsOn: ['execution'], parallelGroup: 5 });
  edges.push({ from: 'execution', to: 'approval' });

  nodes.push({ id: 'review', kind: 'agent', label: 'Review Agent', ref: 'review', dependsOn: ['approval'], parallelGroup: 6 });
  edges.push({ from: 'approval', to: 'review' });

  nodes.push({ id: 'validation', kind: 'validation', label: 'Validation', dependsOn: ['review'], parallelGroup: 7 });
  edges.push({ from: 'review', to: 'validation' });

  nodes.push({ id: 'result', kind: 'result', label: 'Result', dependsOn: ['validation'], parallelGroup: 8 });
  edges.push({ from: 'validation', to: 'result' });

  return { nodes, edges };
}

/** Topologically sort an execution graph into ordered waves. */
export function topoWaves(graph: ExecutionGraph): string[][] {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    adjacency.get(edge.from)?.push(edge.to);
  }

  const waves: string[][] = [];
  let frontier = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const visited = new Set<string>();

  while (frontier.length) {
    waves.push(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      visited.add(id);
      for (const to of adjacency.get(id) ?? []) {
        const remaining = (indegree.get(to) ?? 0) - 1;
        indegree.set(to, remaining);
        if (remaining === 0) next.push(to);
      }
    }
    frontier = next.filter((id) => !visited.has(id));
  }

  return waves;
}
