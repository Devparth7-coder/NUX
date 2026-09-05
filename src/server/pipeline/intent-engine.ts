import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { completeWithTelemetry } from "@/lib/ai";
import { emit } from "@/lib/orchestration/engine";
import { log } from "@/lib/logger";
import type { ParsedIntent } from "@/lib/agents/types";

export const ParsedIntentSchema = z.object({
  objective: z.string().min(1),
  desiredOutcome: z.string().default(""),
  entities: z
    .array(z.object({ type: z.string().default("CONCEPT"), name: z.string().default(""), id: z.string().optional() }))
    .default([]),
  constraints: z.array(z.string()).default([]),
  deadlineText: z.string().nullable().default(null),
  deadline: z.string().nullable().default(null),
  projectContext: z.object({ id: z.string(), name: z.string() }).nullable().default(null),
  requiredCapabilities: z.array(z.string()).default([]),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("LOW"),
  permissionsRequired: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  reasoningSummary: z.string().default(""),
});

/**
 * INTENT ENGINE — turns natural language into a structured, validated intent.
 * Real project/document titles are supplied as grounding so entity extraction
 * resolves to actual workspace ids rather than guesses.
 */
export async function parseAndStoreIntent(args: {
  workspaceId: string;
  userId: string;
  rawInput: string;
  conversationId?: string | null;
  runId?: string | null;
}): Promise<{ intentId: string; intent: ParsedIntent }> {
  const intentRow = await prisma.intent.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.userId,
      conversationId: args.conversationId ?? null,
      rawInput: args.rawInput,
      objective: "understanding",
      desiredOutcome: "",
      status: "RECEIVED",
    },
  });

  await emit(null, intentRow.id, "INTENT_RECEIVED", "Intent received", { rawInput: args.rawInput });

  const [projects, documents] = await Promise.all([
    prisma.project.findMany({
      where: { workspaceId: args.workspaceId, status: { not: "ARCHIVED" } },
      select: { id: true, name: true },
      take: 25,
    }),
    prisma.document.findMany({ where: { workspaceId: args.workspaceId }, select: { title: true }, take: 40 }),
  ]);

  const completion = await completeWithTelemetry<z.infer<typeof ParsedIntentSchema>>(
    {
      purpose: "intent.parse",
      system:
        "You convert a user request into a structured intent. Identify the objective, required capabilities, deadline and the project it refers to. Use only the projects listed in the grounding data.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            request: args.rawInput,
            projectCandidates: projects,
            documentTitles: documents.map((d) => d.title),
          }),
        },
      ],
      schema: ParsedIntentSchema,
      metadata: { rawInput: args.rawInput, projectCandidates: projects, documentTitles: documents.map((d) => d.title) },
    },
    { workspaceId: args.workspaceId, runId: args.runId ?? null },
  );

  const parsed = completion.data ?? ParsedIntentSchema.parse({});

  // Resolve the project context against the database — never trust a model id.
  let projectContext: { id: string; name: string } | null = null;
  if (parsed.projectContext?.id) {
    const match = projects.find((p) => p.id === parsed.projectContext!.id);
    if (match) projectContext = { id: match.id, name: match.name };
  }
  if (!projectContext && parsed.projectContext?.name) {
    const match = projects.find((p) => p.name.toLowerCase() === parsed.projectContext!.name.toLowerCase());
    if (match) projectContext = { id: match.id, name: match.name };
  }

  const deadlineDate = safeDate(parsed.deadline);

  await prisma.intent.update({
    where: { id: intentRow.id },
    data: {
      objective: parsed.objective,
      desiredOutcome: parsed.desiredOutcome,
      entities: parsed.entities as Prisma.InputJsonValue,
      constraints: parsed.constraints,
      deadlineText: parsed.deadlineText,
      deadline: deadlineDate,
      projectId: projectContext?.id ?? null,
      capabilities: parsed.requiredCapabilities,
      riskLevel: parsed.riskLevel,
      permissions: parsed.permissionsRequired,
      status: "UNDERSTOOD",
      confidence: parsed.confidence,
      understoodAt: new Date(),
      metadata: { reasoningSummary: parsed.reasoningSummary, provider: completion.provider, simulated: completion.simulated } as Prisma.InputJsonValue,
    },
  });

  await emit(null, intentRow.id, "INTENT_UNDERSTOOD", `Understood: ${parsed.objective}${parsed.deadlineText ? ` · deadline ${parsed.deadlineText}` : ""}`, {
    objective: parsed.objective,
    deadlineText: parsed.deadlineText,
    deadline: deadlineDate?.toISOString() ?? null,
    project: projectContext,
    capabilities: parsed.requiredCapabilities,
    riskLevel: parsed.riskLevel,
    confidence: parsed.confidence,
    reasoning: parsed.reasoningSummary,
    simulated: completion.simulated,
  });

  log.info(`intent ${intentRow.id}: ${parsed.objective} (confidence ${parsed.confidence})`);

  return {
    intentId: intentRow.id,
    intent: {
      ...parsed,
      projectContext,
      deadline: deadlineDate?.toISOString() ?? null,
    } as ParsedIntent,
  };
}

function safeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
