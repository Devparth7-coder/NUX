import { describe, expect, it } from "vitest";
import "@/lib/tools";
import { prepareToolCall, listTools, toolManifest } from "@/lib/tools/registry";
import { prisma, WORKSPACE_ID, USER_ID } from "./helpers";

const ctx = { workspaceId: WORKSPACE_ID, userId: USER_ID, projectId: null };

describe("Tool Registry", () => {
  it("registers tools across all required categories", () => {
    const categories = new Set(listTools().map((t) => t.category));
    for (const c of ["WEB", "DOCUMENTS", "KNOWLEDGE", "PROJECTS", "TASKS", "FILES", "CALENDAR", "EMAIL", "GITHUB", "DATA_ANALYSIS"]) {
      expect(categories.has(c as never)).toBe(true);
    }
  });

  it("exposes a JSON schema for every tool", () => {
    for (const tool of toolManifest()) {
      expect(tool.schema).toHaveProperty("type", "object");
      expect(tool.schema).toHaveProperty("properties");
    }
  });

  it("rejects invalid tool input before execution", async () => {
    await expect(prepareToolCall({ key: "tasks.create", input: { tasks: [] }, ctx, autoApproveRead: true })).rejects.toThrow(/invalid input/i);
  });

  it("marks write tools as approval-required without executing them", async () => {
    const prepared = await prepareToolCall({
      key: "tasks.create",
      input: { tasks: [{ title: "Test task from unit test" }] },
      ctx,
      autoApproveRead: true,
    });
    expect(prepared.decision.requiresApproval).toBe(true);
    expect(prepared.summary).toMatch(/Create 1 task/);
    const created = await prisma.task.findFirst({ where: { workspaceId: WORKSPACE_ID, title: "Test task from unit test" } });
    expect(created).toBeNull();
  });

  it("runs read tools for real", async () => {
    const prepared = await prepareToolCall({ key: "tasks.list", input: { limit: 5 }, ctx, autoApproveRead: true });
    expect(prepared.decision.requiresApproval).toBe(false);
    const { runToolExecution } = await import("@/lib/tools/registry");
    const execution = await prisma.toolExecution.create({
      data: { workspaceId: WORKSPACE_ID, toolKey: "tasks.list", status: "PENDING", input: { limit: 5 }, permissionLevel: "READ" },
    });
    const output = (await runToolExecution(execution.id, ctx)) as unknown[];
    expect(Array.isArray(output)).toBe(true);
    const refreshed = await prisma.toolExecution.findUnique({ where: { id: execution.id } });
    expect(refreshed?.status).toBe("SUCCEEDED");
    expect(refreshed?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("refuses external tools whose integration is not connected", async () => {
    await expect(
      prepareToolCall({ key: "web.search", input: { query: "nexus launch" }, ctx, autoApproveRead: true }),
    ).resolves.toBeTruthy();
    const prepared = await prepareToolCall({ key: "web.search", input: { query: "nexus launch" }, ctx, autoApproveRead: true });
    expect(prepared.decision.allowed).toBe(true);
    const { runToolExecution } = await import("@/lib/tools/registry");
    const execution = await prisma.toolExecution.create({
      data: { workspaceId: WORKSPACE_ID, toolKey: "web.search", status: "PENDING", input: { query: "nexus launch" }, permissionLevel: "READ" },
    });
    await expect(runToolExecution(execution.id, ctx)).rejects.toThrow(/unavailable|no search provider/i);
  });
});
