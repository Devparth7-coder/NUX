import { z } from "zod";
import { registerTool } from "@/lib/tools/registry";
import { saveMemory, searchMemory } from "@/lib/memory/manager";

registerTool({
  key: "memory.search",
  name: "Search memory",
  description: "Search persistent memory across short-term, project, long-term and explicit layers.",
  category: "MEMORY",
  permissionLevel: "READ",
  inputSchema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(20).default(8) }),
  summarize: (i) => `Search memory for “${i.query}”`,
  handler: async (input, ctx) => {
    const memories = await searchMemory(ctx.workspaceId, input.query, input.limit ?? 8);
    return {
      count: memories.length,
      memories: memories.map((m) => ({
        id: m.id,
        content: m.content,
        type: m.type,
        importance: m.importance,
        confidence: m.confidence,
        updatedAt: m.updatedAt,
      })),
    };
  },
});

registerTool({
  key: "memory.save",
  name: "Save memory",
  description: "Persist a durable fact or preference into NEXUS memory.",
  category: "MEMORY",
  permissionLevel: "WRITE",
  inputSchema: z.object({
    content: z.string().min(12).max(2000),
    type: z.enum(["SHORT_TERM", "PROJECT", "LONG_TERM", "EXPLICIT"]).default("LONG_TERM"),
    scope: z.enum(["SESSION", "PROJECT", "USER", "WORKSPACE"]).default("USER"),
    importance: z.number().min(0).max(1).default(0.6),
    projectId: z.string().nullish(),
    tags: z.array(z.string()).default([]),
  }),
  summarize: (i) => `Remember: “${i.content.slice(0, 90)}${i.content.length > 90 ? "…" : ""}”`,
  affectedData: (i) => ({ type: i.type, scope: i.scope, importance: i.importance, content: i.content }),
  handler: async (input, ctx) => {
    const id = await saveMemory({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      projectId: input.projectId ?? null,
      content: input.content,
      type: input.type,
      scope: input.scope,
      importance: input.importance,
      source: "agent",
      tags: input.tags,
    });
    return { saved: Boolean(id), memoryId: id };
  },
});
