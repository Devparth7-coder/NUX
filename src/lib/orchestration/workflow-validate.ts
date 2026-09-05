type Node = { id: string; key: string; type: string; label: string; config?: unknown };
type Edge = { id: string; sourceId: string; targetId: string };

/** Structural validation for the workflow builder: no orphan nodes, one trigger, acyclic. */
export function validateWorkflow(nodes: Node[], edges: Edge[]) {
  const errors: string[] = [];
  const warnings: string[] = [];

  const triggers = nodes.filter((n) => n.type === "TRIGGER");
  if (!nodes.length) errors.push("Workflow has no nodes");
  if (triggers.length === 0) warnings.push("No TRIGGER node — the first node will be used as the entry point");
  if (triggers.length > 1) warnings.push("More than one TRIGGER node; the first will be used");

  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.sourceId) || !ids.has(e.targetId)) errors.push("An edge references a node that no longer exists");
  }

  const outgoing = new Map<string, number>();
  for (const e of edges) outgoing.set(e.sourceId, (outgoing.get(e.sourceId) ?? 0) + 1);
  for (const n of nodes) {
    if (n.type === "OUTPUT") continue;
    if (!outgoing.get(n.id) && n.type !== "OUTPUT") warnings.push(`Node “${n.label}” has no outgoing connection`);
  }

  // cycle detection
  const adjacency = new Map<string, string[]>();
  for (const e of edges) adjacency.set(e.sourceId, [...(adjacency.get(e.sourceId) ?? []), e.targetId]);
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const next of adjacency.get(id) ?? []) if (visit(next)) return true;
    state.set(id, 2);
    return false;
  };
  if (nodes.some((n) => visit(n.id))) errors.push("Workflow contains a cycle");

  return { ok: errors.length === 0, errors, warnings };
}
