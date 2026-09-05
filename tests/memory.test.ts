import { describe, expect, it } from "vitest";
import { saveMemory, searchMemory, runMemoryLifecycle } from "@/lib/memory/manager";
import { prisma, WORKSPACE_ID, USER_ID } from "./helpers";

describe("Memory architecture", () => {
  it("saves, embeds and retrieves memories", async () => {
    const id = await saveMemory({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      content: "Unit test memory: the launch retrospective is scheduled for next Monday.",
      type: "EXPLICIT",
      scope: "USER",
      importance: 0.7,
      source: "test",
      tags: ["test"],
    });
    expect(id).toBeTruthy();

    const found = await searchMemory(WORKSPACE_ID, "launch retrospective", 5);
    expect(found.some((m) => m.id === id)).toBe(true);

    const row = await prisma.memory.findUnique({ where: { id: id! } });
    expect(row?.accessCount).toBeGreaterThan(0);
  });

  it("does not duplicate identical enabled memories", async () => {
    const content = "Duplicate detection test: NEXUS persists only durable facts.";
    const first = await saveMemory({ workspaceId: WORKSPACE_ID, userId: USER_ID, content, type: "LONG_TERM", scope: "USER", source: "test" });
    const second = await saveMemory({ workspaceId: WORKSPACE_ID, userId: USER_ID, content, type: "LONG_TERM", scope: "USER", source: "test" });
    expect(first).toBe(second);
  });

  it("expires stale short-term memories during lifecycle maintenance", async () => {
    const id = await saveMemory({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      content: "Short lived session note for lifecycle test.",
      type: "SHORT_TERM",
      scope: "SESSION",
      source: "test",
      expiresAt: new Date(Date.now() - 1000),
    });
    await runMemoryLifecycle(WORKSPACE_ID);
    const row = await prisma.memory.findUnique({ where: { id: id! } });
    expect(row?.enabled).toBe(false);
  });
});
