/**
 * BM25 keyword scoring. Real probabilistic relevance ranking — the keyword half
 * of NEXUS hybrid retrieval.
 */

import { tokenize, stem } from './embed';

export interface BM25Document {
  id: string;
  text: string;
}

export interface BM25Scored {
  id: string;
  score: number;
}

const K1 = 1.5;
const B = 0.75;

function analyse(text: string): string[] {
  return tokenize(text).map(stem);
}

/**
 * Score `query` against a corpus. Scores are normalised to 0..1 against the
 * best match so they can be blended with cosine similarity.
 */
export function bm25Score(query: string, corpus: BM25Document[]): BM25Scored[] {
  const queryTerms = new Set(analyse(query));
  if (!queryTerms.size || !corpus.length) return corpus.map((d) => ({ id: d.id, score: 0 }));

  const docs = corpus.map((d) => ({ id: d.id, terms: analyse(d.text), len: 0 }));
  for (const d of docs) d.len = d.terms.length;
  const avgdl = docs.reduce((sum, d) => sum + d.len, 0) / Math.max(1, docs.length);

  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const d of docs) if (d.terms.includes(term)) count++;
    df.set(term, count);
  }

  const N = docs.length;
  const scored: BM25Scored[] = docs.map((d) => {
    let score = 0;
    const tf = new Map<string, number>();
    for (const t of d.terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const term of queryTerms) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / Math.max(1, avgdl)))));
    }
    return { id: d.id, score };
  });

  const max = scored.reduce((m, s) => Math.max(m, s.score), 0);
  if (max > 0) for (const s of scored) s.score = s.score / max;
  return scored;
}
