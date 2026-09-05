import type { PermissionLevel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { ExecutableError } from "@/lib/errors";
import { evaluatePermission, type PermissionDecision } from "@/lib/permissions/engine";
import { bus } from "@/lib/events/bus";
import type { ToolCategory, ToolContext, ToolDefinition } from "./types";

const registry = new Map<string, ToolDefinition>();

export function registerTool<I extends import("zod").ZodTypeAny, O>(def: ToolDefinition<I, O>) {
  registry.set(def.key, def as unknown as ToolDefinition);
}

export function getTool(key: string) {
  return registry.get(key);
}

export function listTools(filter?: { category?: ToolCategory }) {
  const all = [...registry.values()];
  return filter?.category ? all.filter((t) => t.category === filter.category) : all;
}

export function toolManifest() {
  return [...registry.values()].map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    category: t.category,
    permissionLevel: t.permissionLevel,
    requiresIntegration: t.requiresIntegration ?? null,
    timeoutMs: t.timeoutMs ?? 30_000,
    retryPolicy: t.retryPolicy ?? { maxAttempts: 2, backoffMs: 500 },
    schema: safeSchema(t.key, t.inputSchema),
  }));
}

/** Keeps the `Tool` table in sync with the code registry (discoverability + telemetry). */
export async function syncToolsToDb(workspaceId: string) {
  const manifest = toolManifest();
  for (const t of manifest) {
    await prisma.tool.upsert({
      where: { workspaceId_key: { workspaceId, key: t.key } },
      update: {
        name: t.name,
        description: t.description,
        category: t.category,
        permissionLevel: t.permissionLevel,
        requiresAuth: t.requiresIntegration,
        timeoutMs: t.timeoutMs,
        retryPolicy: t.retryPolicy as Prisma.InputJsonValue,
        schema: t.schema as Prisma.InputJsonValue,
      },
      create: {
        workspaceId,
        key: t.key,
        name: t.name,
        description: t.description,
        category: t.category,
        permissionLevel: t.permissionLevel,
        requiresAuth: t.requiresIntegration,
        timeoutMs: t.timeoutMs,
        retryPolicy: t.retryPolicy as Prisma.InputJsonValue,
        schema: t.schema as Prisma.InputJsonValue,
      },
    });
  }
  return manifest.length;
}

export type PreparedToolCall = {
  toolKey: string;
  toolName: string;
  category: ToolCategory;
  permissionLevel: PermissionLevel;
  input: Record<string, unknown>;
  summary: string;
  affectedData: Record<string, unknown>;
  decision: PermissionDecision;
  definition: ToolDefinition;
};

/**
 * Validates input against the tool's zod schema and resolves the permission
 * decision. Nothing is executed here.
 */
export async function prepareToolCall(args: {
  key: string;
  input: unknown;
  ctx: ToolContext;
  autoApproveRead: boolean;
  integrationStatus?: "CONNECTED" | "DISCONNECTED" | "ERROR" | "NOT_CONFIGURED";
}): Promise<PreparedToolCall> {
  const def = registry.get(args.key);
  if (!def) throw new ExecutableError(`Unknown tool: ${args.key}`, { retryable: false });

  const parsed = def.inputSchema.safeParse(args.input);
  if (!parsed.success) {
    throw new ExecutableError(
      `Invalid input for ${args.key}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      { retryable: false, detail: parsed.error.flatten() },
    );
  }

  const decision = evaluatePermission(def.permissionLevel, {
    autoApproveRead: args.autoApproveRead,
    integrationStatus: args.integrationStatus,
  });

  return {
    toolKey: def.key,
    toolName: def.name,
    category: def.category,
    permissionLevel: def.permissionLevel,
    input: parsed.data as Record<string, unknown>,
    summary: def.summarize(parsed.data),
    affectedData: def.affectedData?.(parsed.data) ?? {},
    decision,
    definition: def,
  };
}

/**
 * Executes a previously recorded ToolExecution row (created by the orchestrator
 * before approval). Records latency, failures and telemetry.
 */
export async function runToolExecution(executionId: string, ctx: ToolContext) {
  const execution = await prisma.toolExecution.findUnique({ where: { id: executionId } });
  if (!execution) throw new ExecutableError(`Tool execution ${executionId} not found`, { retryable: false });
  const def = registry.get(execution.toolKey);
  if (!def) throw new ExecutableError(`Unknown tool: ${execution.toolKey}`, { retryable: false });

  const startedAt = new Date();
  await prisma.toolExecution.update({
    where: { id: executionId },
    data: { status: "RUNNING", startedAt, attempt: { increment: 1 } },
  });
  bus.publish(`run:${execution.runId ?? "none"}`, "TOOL_STARTED", `${def.name} started`, {
    toolKey: def.key,
    executionId,
  });

  const parsed = def.inputSchema.safeParse(execution.input);
  if (!parsed.success) {
    const err = `Input validation failed: ${parsed.error.issues.map((i) => i.message).join("; ")}`;
    await finish(executionId, def.key, "FAILED", null, err, startedAt, ctx);
    throw new ExecutableError(err, { retryable: false });
  }

  try {
    const timeoutMs = def.timeoutMs ?? 30_000;
    const output = await withTimeout(Promise.resolve(def.handler(parsed.data, ctx)), timeoutMs);
    await finish(executionId, def.key, "SUCCEEDED", (output ?? null) as Prisma.InputJsonValue, null, startedAt, ctx);
    bus.publish(`run:${execution.runId ?? "none"}`, "TOOL_COMPLETED", `${def.name} completed`, {
      toolKey: def.key,
      executionId,
    });
    return output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = err instanceof ExecutableError ? err.retryable : false;
    await finish(executionId, def.key, "FAILED", null, message, startedAt, ctx);
    bus.publish(`run:${execution.runId ?? "none"}`, "TOOL_FAILED", `${def.name} failed: ${message}`, {
      toolKey: def.key,
      executionId,
    });
    throw err instanceof ExecutableError ? err : new ExecutableError(message, { retryable });
  }
}

async function finish(
  executionId: string,
  toolKey: string,
  status: "SUCCEEDED" | "FAILED",
  output: Prisma.InputJsonValue | null,
  error: string | null,
  startedAt: Date,
  ctx: ToolContext,
) {
  const durationMs = Date.now() - startedAt.getTime();
  await prisma.toolExecution.update({
    where: { id: executionId },
    data: {
      status,
      output: output ?? undefined,
      error: error ?? null,
      durationMs,
      completedAt: new Date(),
    },
  });
  await prisma.tool
    .updateMany({
      where: { workspaceId: ctx.workspaceId, key: toolKey },
      data: {
        totalCalls: { increment: 1 },
        failedCalls: status === "FAILED" ? { increment: 1 } : undefined,
        totalLatencyMs: { increment: durationMs },
        lastCalledAt: new Date(),
      },
    })
    .catch((e) => log.warn("tool telemetry update failed", e));
}

/** Direct execution for trusted, read-only paths (search surfaces, API routes). */
export async function executeReadOnly<I = unknown, O = unknown>(key: string, input: unknown, ctx: ToolContext): Promise<O> {
  const def = registry.get(key);
  if (!def) throw new ExecutableError(`Unknown tool: ${key}`, { retryable: false });
  if (def.permissionLevel !== "READ") throw new ExecutableError(`Tool ${key} is not read-only`, { retryable: false });
  const parsed = def.inputSchema.safeParse(input);
  if (!parsed.success) throw new ExecutableError(`Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`, { retryable: false });
  return (await def.handler(parsed.data, ctx)) as O;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ExecutableError(`Tool timed out after ${ms}ms`, { retryable: true })), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeSchema(_key: string, schema: import("zod").ZodTypeAny): Record<string, unknown> {
  try {
    return zodToJsonSchema(schema);
  } catch {
    return { type: "object", properties: {}, required: [] };
  }
}

/** Minimal zod → JSON Schema introspection for the tool catalogue UI. */
type AnyZod = { _def?: { typeName?: string; innerType?: AnyZod; schema?: AnyZod; description?: string }; description?: string; safeParse?: unknown };

function unwrapSchema(schema: AnyZod): AnyZod {
  let current = schema;
  for (let i = 0; i < 8; i++) {
    const def = current._def;
    if (!def) return current;
    if (def.typeName === "ZodObject") return current;
    const next = def.schema ?? def.innerType;
    if (!next) return current;
    current = next;
  }
  return current;
}

function zodToJsonSchema(schema: import("zod").ZodTypeAny): Record<string, unknown> {
  const target = unwrapSchema(schema as unknown as AnyZod) as unknown as { shape?: (() => Record<string, AnyZod>) | Record<string, AnyZod> };
  // zod exposes `shape` as a getter returning the object (v3.25+) or as a method (older v3).
  const shape = (typeof target.shape === "function" ? target.shape() : target.shape) ?? {};
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const inner = unwrapSchema(value);
    const typeName = inner._def?.typeName ?? "ZodString";
    const optional = value._def?.typeName === "ZodOptional" || value._def?.typeName === "ZodDefault";
    properties[key] = {
      type: typeName === "ZodNumber" ? "number" : typeName === "ZodBoolean" ? "boolean" : typeName === "ZodArray" ? "array" : typeName === "ZodEnum" ? "string" : "string",
      description: inner.description,
      enum: typeName === "ZodEnum" ? ((inner._def as unknown as { values?: string[] }).values ?? undefined) : undefined,
    };
    if (!optional) required.push(key);
  }
  return { type: "object", properties, required };
}
