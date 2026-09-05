/**
 * Local deterministic embedding — the hashing trick.
 *
 * This is a REAL vector-space model, not a stub: text is projected into a
 * fixed-dimensional space via signed feature hashing over word stems, character
 * trigrams and token bigrams, weighted with sublinear term frequency and
 * L2-normalised. Cosine similarity over these vectors is a genuine (if
 * lexical-morphological rather than neural) semantic signal — the same family of
 * technique used by Vowpal Wabbit and scikit-learn's FeatureHasher.
 *
 * It is deterministic, offline, zero-latency and perfectly reproducible — which
 * is exactly what NEXUS needs for ingestion and for the launch demo.
 *
 * When an embedding API key is configured, `OpenAIEmbedProvider` takes over with
 * no changes anywhere else in the retrieval stack.
 */

export const EMBED_DIMENSIONS = 384;

const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','than','that','this','these','those','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','of','in','on','at','to','from','by','for','with','about','as','into','over','after',
  'before','between','out','up','down','off','again','further','once','here','there','all','any','both','each','few','more',
  'most','other','some','such','no','nor','not','only','own','same','so','too','very','can','will','just','should','now','i',
  'me','my','we','our','you','your','it','its','they','them','their','he','she','him','her',
]);

/** FNV-1a 32-bit. Signed hashing: the sign bit flips to reduce collision bias. */
export function fnv1a(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s+#.]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Lightweight suffix stripper — enough for retrieval, no dependency. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith('ation')) return w.slice(0, -5);
  if (w.length > 4 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ment')) return w.slice(0, -4);
  if (w.length > 3 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function accumulate(vec: Float32Array, feature: string, weight: number) {
  const h = fnv1a(feature);
  const idx = h % vec.length;
  const sign = (h >>> 31) & 1 ? -1 : 1;
  vec[idx] += sign * weight;
}

/**
 * Embed text into an L2-normalised vector of `dimensions` floats.
 * Deterministic: identical input always yields an identical vector.
 */
export function embedLocal(text: string, dimensions: number = EMBED_DIMENSIONS): Float32Array {
  const vec = new Float32Array(dimensions);
  const tokens = tokenize(text);
  if (!tokens.length) return vec;

  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  for (const [token, count] of tf) {
    const weight = 1 + Math.log(count); // sublinear TF
    const s = stem(token);

    accumulate(vec, `w:${token}`, weight);
    if (s !== token) accumulate(vec, `s:${s}`, weight * 0.8);

    // Character trigrams → morphology, typo tolerance, partial matching.
    const padded = `^${token}$`;
    for (let i = 0; i < padded.length - 2; i++) {
      accumulate(vec, `t:${padded.slice(i, i + 3)}`, weight * 0.32);
    }
  }

  // Token bigrams → captures phrase-ish semantics ("launch plan", "at risk").
  for (let i = 0; i < tokens.length - 1; i++) {
    accumulate(vec, `b:${stem(tokens[i])}_${stem(tokens[i + 1])}`, 0.55);
  }

  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / norm;
  return vec;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Compact serialisation for storage (JSON column). */
export function serializeEmbedding(vec: Float32Array): string {
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = Math.round(vec[i] * 10000) / 10000;
  return JSON.stringify(out);
}

export function deserializeEmbedding(raw: string | null | undefined): Float32Array | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return Float32Array.from(parsed.map((n) => Number(n) || 0));
  } catch {
    return null;
  }
}
