import { env, EMBEDDING_DIM } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("embeddings");

/** FNV-1a — deterministic across processes and restarts. */
function fnv1a(input: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const STOP = new Set(
  "the a an and or of to in for on with at by from is are was were be been being this that it its as can will would should could have has had not no but if then than so we you your our their they he she i me my them there here what which who whom whose when where why how all any both each few more most other some such only own same too very s t just don now".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Deterministic lexical embedding:
 *  - token term frequency (sub-linear) projected by hashing into EMBEDDING_DIM
 *  - character trigrams capture morphology and typos
 *  - L2-normalised so cosine distance in pgvector behaves correctly
 *
 * This is a real, reproducible vector space (identical input ⇒ identical vector),
 * not a random or placeholder array. Configure EMBEDDING_PROVIDER=openai for
 * semantic embeddings from a hosted model.
 */
export function localEmbed(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = tokenize(text);
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const [token, count] of tf) {
    const weight = 1 + Math.log(count);
    const h = fnv1a(token);
    vec[h % EMBEDDING_DIM] += weight;
    vec[(h >>> 8) % EMBEDDING_DIM] += weight * 0.5;
  }
  const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  for (let i = 0; i + 3 <= clean.length; i++) {
    const tri = clean.slice(i, i + 3);
    if (tri.trim().length < 3) continue;
    vec[fnv1a(tri, 0x9e3779b1) % EMBEDDING_DIM] += 0.25;
  }
  const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (env.EMBEDDING_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    try {
      const { getProvider } = await import("@/lib/ai");
      const res = await getProvider("openai").embed(texts);
      if (res.vectors[0]?.length === EMBEDDING_DIM) return res.vectors;
      log.warn(`OpenAI embedding dimension ${res.vectors[0]?.length} != ${EMBEDDING_DIM}; projecting locally`);
      return texts.map((t) => projectToDim(localEmbed(t)));
    } catch (err) {
      log.warn("OpenAI embedding failed, using local deterministic embeddings", err);
    }
  }
  return texts.map((t) => projectToDim(localEmbed(t)));
}

function projectToDim(v: number[]): number[] {
  if (v.length === EMBEDDING_DIM) return v;
  const out = new Array<number>(EMBEDDING_DIM).fill(0);
  for (let i = 0; i < v.length; i++) out[i % EMBEDDING_DIM] += v[i];
  const norm = Math.sqrt(out.reduce((a, x) => a + x * x, 0)) || 1;
  return out.map((x) => Number((x / norm).toFixed(6)));
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
