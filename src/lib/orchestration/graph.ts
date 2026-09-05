export type ExecutionStep = {
  id: string;
  agent: string;
  title: string;
  capability: string;
  dependsOn: string[];
  rationale?: string;
};

export type ExecutionGraph = {
  steps: ExecutionStep[];
  createdAt: string;
};

/**
 * Groups steps into dependency levels. Steps in the same level have no
 * interdependencies and may execute in parallel. Cycles are detected and
 * rejected so the graph is always a DAG.
 */
export function topoLevels(graph: ExecutionGraph): string[][] {
  const ids = new Set(graph.steps.map((s) => s.id));
  for (const step of graph.steps) {
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) throw new Error(`Step ${step.id} depends on unknown step ${dep}`);
    }
  }

  const levels: string[][] = [];
  const resolved = new Set<string>();
  const remaining = [...graph.steps];
  let guard = 0;

  while (remaining.length) {
    if (guard++ > 100) throw new Error("Cycle detected in execution graph");
    const level = remaining.filter((s) => s.dependsOn.every((d) => resolved.has(d))).map((s) => s.id);
    if (!level.length) throw new Error("Cycle detected in execution graph");
    level.forEach((id) => resolved.add(id));
    levels.push(level);
    for (const id of level) remaining.splice(remaining.findIndex((s) => s.id === id), 1);
  }
  return levels;
}

export function validateGraph(graph: ExecutionGraph): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!graph.steps.length) errors.push("Graph has no steps");
  try {
    topoLevels(graph);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Invalid graph");
  }
  const ids = new Set<string>();
  for (const s of graph.steps) {
    if (ids.has(s.id)) errors.push(`Duplicate step id ${s.id}`);
    ids.add(s.id);
  }
  return { ok: errors.length === 0, errors };
}
