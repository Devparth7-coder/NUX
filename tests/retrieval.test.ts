import { describe, expect, it } from "vitest";
import { hybridSearch } from "@/lib/retrieval/hybrid";
import { buildContext } from "@/lib/retrieval/context-engine";
import { localEmbed, cosine } from "@/lib/retrieval/embeddings";
import { WORKSPACE_ID } from "./helpers";

describe("Hybrid retrieval", () => {
  it("returns real workspace evidence with provenance", async () => {
    const results = await hybridSearch({ workspaceId: WORKSPACE_ID, query: "launch deadline risks", limit: 8 });
    expect(results.length).toBeGreaterThan(0);
    for (const item of results) {
      expect(item.snippet.length).toBeGreaterThan(0);
      expect(item.why.length).toBeGreaterThan(0);
      expect(item.score.total).toBeGreaterThan(0);
      expect(["DOCUMENT", "KNOWLEDGE", "MEMORY", "TASK"]).toContain(item.kind);
    }
  });

  it("scopes retrieval to the active project (plus workspace-wide memory)", async () => {
    const project = await (await import("./helpers")).prisma.project.findFirst({ where: { workspaceId: WORKSPACE_ID, slug: "nexus-launch" } });
    const results = await hybridSearch({ workspaceId: WORKSPACE_ID, query: "launch", projectId: project!.id, limit: 6 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.projectId === project!.id || r.projectId === null)).toBe(true);
    expect(results.filter((r) => r.projectId === project!.id).length).toBeGreaterThan(0);
  });

  it("produces deterministic, normalised embeddings", () => {
    const a = localEmbed("NEXUS orchestrates agents");
    const b = localEmbed("NEXUS orchestrates agents");
    const c = localEmbed("Something completely different");
    expect(a).toEqual(b);
    expect(a).toHaveLength(512);
    expect(cosine(a, b)).toBeCloseTo(1, 5);
    expect(cosine(a, c)).toBeLessThan(0.9);
  });
});

describe("Context Engine", () => {
  it("assembles grounded context with confidence and sources", async () => {
    const context = await buildContext({ workspaceId: WORKSPACE_ID, query: "prepare the launch for this week", limit: 10 });
    expect(context.items.length).toBeGreaterThan(0);
    expect(context.confidence).toBeGreaterThan(0);
    expect(context.sources.length).toBeGreaterThan(0);
    expect(context.documents.length).toBeGreaterThan(0);
    expect(context.openTasks.length).toBeGreaterThan(0);
  });
});
