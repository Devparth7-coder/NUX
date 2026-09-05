import type { ZodTypeAny } from "zod";

/**
 * Never trust raw model output.
 * Attempts, in order: direct parse → JSON extraction → recursive default construction.
 */
export function coerceToSchema<T>(schema: ZodTypeAny, raw: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const direct = schema.safeParse(raw);
  if (direct.success) return { ok: true, data: direct.data as T };

  if (typeof raw === "string") {
    const extracted = extractJson(raw);
    if (extracted !== undefined) {
      const parsed = schema.safeParse(extracted);
      if (parsed.success) return { ok: true, data: parsed.data as T };
    }
  }

  const built = buildFromSchema(schema);
  if (built !== undefined) {
    const merged = schema.safeParse(deepMerge(built, pickUsable(raw)));
    if (merged.success) return { ok: true, data: merged.data as T };
  }
  return { ok: false, error: `Output did not satisfy schema: ${direct.error.issues.map((i) => i.message).join("; ")}` };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;
  const sliced = candidate.slice(start);
  try {
    return JSON.parse(sliced);
  } catch {
    try {
      return JSON.parse(sliced.slice(0, sliced.lastIndexOf("}") + 1));
    } catch {
      try {
        return JSON.parse(sliced.slice(0, sliced.lastIndexOf("]") + 1));
      } catch {
        return undefined;
      }
    }
  }
}

function pickUsable(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v !== undefined && v !== null) out[k] = v;
    }
    return out;
  }
  return raw;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (Array.isArray(base)) return Array.isArray(patch) && patch.length ? patch : base;
  if (base && typeof base === "object" && patch && typeof patch === "object" && !Array.isArray(patch)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out;
  }
  return patch === undefined ? base : patch;
}

/** Builds a minimal valid instance of a zod schema (used as a safe fallback). */
export function buildFromSchema(schema: ZodTypeAny): unknown {
  const def = (schema as unknown as { _def?: { typeName?: string; innerType?: ZodTypeAny; shape?: () => Record<string, ZodTypeAny>; options?: ZodTypeAny[]; type?: ZodTypeAny } })._def;
  if (!def) return undefined;
  switch (def.typeName) {
    case "ZodString":
      return "";
    case "ZodNumber":
      return 0;
    case "ZodBoolean":
      return false;
    case "ZodArray":
      return [];
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return buildFromSchema((def.innerType ?? def.type) as ZodTypeAny);
    case "ZodEnum": {
      const values = (def as unknown as { values?: string[] }).values;
      return values?.[0] ?? "";
    }
    case "ZodObject": {
      const shape = def.shape?.() ?? {};
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(shape)) {
        const inner = v as ZodTypeAny & { _def?: { typeName?: string } };
        if (inner._def?.typeName === "ZodOptional" || inner._def?.typeName === "ZodDefault") continue;
        out[k] = buildFromSchema(inner);
      }
      return out;
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const first = def.options?.[0];
      return first ? buildFromSchema(first) : undefined;
    }
    default:
      return undefined;
  }
}
