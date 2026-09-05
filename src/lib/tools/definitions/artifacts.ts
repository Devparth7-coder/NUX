import { z } from "zod";
import { prisma } from "@/lib/db";
import { registerTool } from "@/lib/tools/registry";
import { recordActivity } from "@/server/services/activity";

registerTool({
  key: "artifact.generate",
  name: "Generate artifact",
  description: "Persist a generated deliverable (report, plan, research summary, table, brief) as a downloadable artifact.",
  category: "ARTIFACT_GENERATION",
  permissionLevel: "WRITE",
  inputSchema: z.object({
    type: z.enum(["REPORT", "RESEARCH_SUMMARY", "TASK_PLAN", "PRESENTATION", "TABLE", "ANALYSIS", "DOCUMENT", "BRIEF"]).default("REPORT"),
    title: z.string().min(3).max(200),
    summary: z.string().max(600).nullish(),
    content: z.string().min(10),
    format: z.enum(["markdown", "json", "csv"]).default("markdown"),
    projectId: z.string().nullish(),
    structured: z.record(z.unknown()).default({}),
  }),
  summarize: (i) => `Generate artifact “${i.title}”`,
  affectedData: (i) => ({ type: i.type, title: i.title, bytes: i.content.length, format: i.format }),
  handler: async (input, ctx) => {
    const artifact = await prisma.artifact.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId: input.projectId ?? ctx.projectId ?? null,
        intentId: ctx.intentId ?? null,
        runId: ctx.runId ?? null,
        createdById: ctx.userId,
        type: input.type,
        title: input.title,
        summary: input.summary ?? null,
        content: input.content,
        structured: input.structured as never,
        format: input.format,
        bytes: Buffer.byteLength(input.content, "utf8"),
      },
    });
    await recordActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      projectId: artifact.projectId,
      kind: "AGENT",
      action: "artifact.generate",
      summary: `Generated artifact “${artifact.title}”`,
      detail: { artifactId: artifact.id, type: artifact.type },
      entityType: "ARTIFACT",
      entityId: artifact.id,
      status: "success",
    });
    return { id: artifact.id, title: artifact.title, type: artifact.type, bytes: artifact.bytes };
  },
});
