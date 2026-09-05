/**
 * Tool Registry (§12).
 *
 * Tools are discovered dynamically, validated against Zod schemas before
 * execution, and executed under a timeout with a retry policy. Every call is
 * recorded by the orchestrator as a ToolExecution row.
 */

import type { AnyTool, ToolContext, ToolDescriptor } from './types';
import { documents } from './builtins/documents';
import { knowledge } from './builtins/knowledge';
import { projects } from './builtins/projects';
import { tasks } from './builtins/tasks';
import { web } from './builtins/web';
import { external } from './builtins/external';
import { artifacts } from './builtins/artifacts';
import { analysis } from './builtins/analysis';
import { files } from './builtins/files';
import { NexusError, toNexusError } from '../errors';
import { createLogger } from '../logger';

const log = createLogger('tools');

export type { ToolContext, ToolDescriptor } from './types';
export { TOOL_CATEGORIES } from './types';

class ToolRegistry {
  private readonly tools = new Map<string, AnyTool>();

  register(tool: AnyTool): void {
    this.tools.set(tool.key, tool);
  }

  registerAll(tools: AnyTool[]): void {
    for (const t of tools) this.register(t);
  }

  get(key: string): AnyTool | undefined {
    return this.tools.get(key);
  }

  require(key: string): AnyTool {
    const tool = this.tools.get(key);
    if (!tool) throw new NexusError('NOT_FOUND', `Unknown tool: ${key}`);
    return tool;
  }

  list(): ToolDescriptor[] {
    return [...this.tools.values()].map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      category: t.category,
      permission: t.permission,
      requiresIntegration: t.requiresIntegration,
      parameters: describeSchema(t),
      enabled: t.enabled ?? true,
      timeoutMs: t.timeoutMs ?? 30_000,
      maxRetries: t.maxRetries ?? 2,
    }));
  }

  byCategory() {
    const out = new Map<string, ToolDescriptor[]>();
    for (const descriptor of this.list()) {
      if (!out.has(descriptor.category)) out.set(descriptor.category, []);
      out.get(descriptor.category)!.push(descriptor);
    }
    return out;
  }

  keys(): string[] {
    return [...this.tools.keys()];
  }

  /** Validate arguments without executing. */
  validate(key: string, args: unknown): { ok: true; value: unknown } | { ok: false; error: string; issues: string[] } {
    const tool = this.require(key);
    const parsed = tool.schema.safeParse(args);
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
      ok: false,
      error: 'Arguments failed schema validation',
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`),
    };
  }

  /** Execute with schema validation, timeout and retry. */
  async execute(key: string, args: unknown, ctx: ToolContext): Promise<{ result: unknown; attempt: number }> {
    const tool = this.require(key);
    const validation = this.validate(key, args);
    if (!validation.ok) {
      throw new NexusError('VALIDATION', `Invalid arguments for ${key}`, { details: validation.issues });
    }

    const timeoutMs = tool.timeoutMs ?? 30_000;
    const maxRetries = tool.maxRetries ?? 2;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await withTimeout(tool.handler(validation.value, ctx), timeoutMs, key);
        return { result, attempt };
      } catch (err) {
        lastError = err;
        const e = toNexusError(err);
        const retryable = e instanceof NexusError ? e.retryable : false;
        log.warn('tool attempt failed', { key, attempt, error: e.message });
        if (attempt > maxRetries || !retryable) break;
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
    throw toNexusError(lastError);
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, key: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NexusError('TOOL_FAILED', `Tool ${key} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Best-effort JSON-Schema projection of a Zod schema, for UI + model tool specs. */
function describeSchema(tool: AnyTool): Record<string, unknown> {
  const shape = (tool.schema as unknown as { _def?: { shape?: () => Record<string, unknown> } })._def?.shape?.();
  if (!shape) return { type: 'object', properties: {} };
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    const v = value as { _def?: { typeName?: string; innerType?: unknown; defaultValue?: unknown } };
    const typeName = v?._def?.typeName ?? 'ZodAny';
    properties[key] = {
      type: zodTypeToJsonType(typeName),
      optional: typeName === 'ZodOptional' || typeName === 'ZodDefault',
      default: v?._def?.defaultValue,
    };
    if (typeName !== 'ZodOptional' && typeName !== 'ZodDefault') required.push(key);
  }
  return { type: 'object', properties, required };
}

function zodTypeToJsonType(typeName: string): string {
  if (typeName.includes('String')) return 'string';
  if (typeName.includes('Number')) return 'number';
  if (typeName.includes('Boolean')) return 'boolean';
  if (typeName.includes('Array')) return 'array';
  if (typeName.includes('Enum')) return 'enum';
  return 'object';
}

export const toolRegistry = new ToolRegistry();
toolRegistry.registerAll([
  ...documents,
  ...knowledge,
  ...projects,
  ...tasks,
  ...web,
  ...external,
  ...artifacts,
  ...analysis,
  ...files,
]);

export { withTimeout };
