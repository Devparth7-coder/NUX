import { describe, expect, it } from "vitest";
import { evaluateCondition } from "@/lib/orchestration/workflow-engine";
import { validateWorkflow } from "@/lib/orchestration/workflow-validate";
import { prisma, WORKSPACE_ID } from "./helpers";

describe("Workflow engine", () => {
  it("evaluates conditions safely without eval", () => {
    expect(evaluateCondition("research.confidence > 0.6", { research: { confidence: 0.8 } })).toBe(true);
    expect(evaluateCondition("research.confidence > 0.6", { research: { confidence: 0.4 } })).toBe(false);
    expect(evaluateCondition("status == ready", { status: "ready" })).toBe(true);
    expect(evaluateCondition("tags contains launch", { tags: ["launch", "demo"] })).toBe(true);
    expect(evaluateCondition("true", {})).toBe(true);
  });

  it("validates workflow structure and rejects cycles", () => {
    const nodes = [
      { id: "a", key: "trigger", type: "TRIGGER", label: "Start" },
      { id: "b", key: "agent", type: "AGENT", label: "Plan" },
      { id: "c", key: "output", type: "OUTPUT", label: "Done" },
    ];
    const ok = validateWorkflow(nodes as never, [
      { id: "e1", sourceId: "a", targetId: "b" },
      { id: "e2", sourceId: "b", targetId: "c" },
    ] as never);
    expect(ok.ok).toBe(true);

    const cyclic = validateWorkflow(nodes as never, [
      { id: "e1", sourceId: "a", targetId: "b" },
      { id: "e2", sourceId: "b", targetId: "a" },
    ] as never);
    expect(cyclic.ok).toBe(false);
    expect(cyclic.errors.join(" ")).toMatch(/cycle/i);
  });

  it("persists versioned workflow definitions", async () => {
    const workflow = await prisma.workflow.findFirst({ where: { workspaceId: WORKSPACE_ID }, include: { nodes: true, edges: true } });
    expect(workflow).toBeTruthy();
    expect(workflow!.nodes.length).toBeGreaterThan(3);
    expect(workflow!.edges.length).toBeGreaterThan(2);
    expect(workflow!.version).toBeGreaterThanOrEqual(1);
    const validation = validateWorkflow(workflow!.nodes as never, workflow!.edges as never);
    expect(validation.ok).toBe(true);
  });
});
