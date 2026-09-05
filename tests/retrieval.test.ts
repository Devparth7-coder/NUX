/**
 * Retrieval: embeddings, keyword scoring and the hybrid blend.
 * Pure functions — no database required.
 */

import { describe, expect, it } from 'vitest';
import { embedLocal, cosineSimilarity, deserializeEmbedding, serializeEmbedding, EMBED_DIMENSIONS } from '../src/lib/retrieval/embed';
import { bm25Score } from '../src/lib/retrieval/bm25';
import { hybridScore, recencyScore, entityScore, explain, RANK_WEIGHTS } from '../src/lib/retrieval/hybrid';

describe('local embedder', () => {
  it('is deterministic', () => {
    expect(Array.from(embedLocal('launch readiness checklist'))).toEqual(Array.from(embedLocal('launch readiness checklist')));
  });

  it('produces a unit-ish vector of the declared size', () => {
    const vector = embedLocal('nexus launch');
    expect(vector.length).toBe(EMBED_DIMENSIONS);
    const norm = Math.sqrt(Array.from(vector).reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeGreaterThan(0.9);
    expect(norm).toBeLessThanOrEqual(1.0001);
  });

  it('scores related text above unrelated text', () => {
    const a = embedLocal('launch plan for NEXUS');
    const b = embedLocal('launch plan for NEXUS platform');
    const c = embedLocal('quarterly payroll reconciliation');
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });

  it('round-trips through serialization', () => {
    const vector = embedLocal('knowledge graph');
    const restored = deserializeEmbedding(serializeEmbedding(vector));
    expect(restored).not.toBeNull();
    expect(cosineSimilarity(vector, restored!)).toBeGreaterThan(0.999);
  });

  it('handles an empty corpus gracefully', () => {
    expect(bm25Score('anything', [])).toEqual([]);
  });
});

describe('bm25', () => {
  // bm25Score preserves corpus order and normalises against the best match;
  // callers rank by the blended relevance score.
  const byScore = (rows: { id: string; score: number }[]) => [...rows].sort((a, b) => b.score - a.score);

  it('scores the documents that contain the query terms above those that do not', () => {
    const corpus = [
      { id: 'a', text: 'The launch brief explains positioning and messaging.' },
      { id: 'b', text: 'Payroll reconciliation happens monthly.' },
      { id: 'c', text: 'Launch checklist: freeze scope, dry run, go live.' },
    ];
    const ranked = byScore(bm25Score('launch', corpus));
    expect(ranked[0]!.id).not.toBe('b');
    expect(ranked.find((r) => r.id === 'b')!.score).toBe(0);
    expect(ranked[0]!.score).toBe(1);
  });

  it('rewards term frequency', () => {
    const corpus = [
      { id: 'once', text: 'launch' },
      { id: 'thrice', text: 'launch launch launch' },
    ];
    const ranked = byScore(bm25Score('launch', corpus));
    expect(ranked[0]!.id).toBe('thrice');
  });

  it('normalises the best match to 1', () => {
    const ranked = bm25Score('nexus', [{ id: 'a', text: 'NEXUS launch brief' }, { id: 'b', text: 'nothing relevant here' }]);
    expect(Math.max(...ranked.map((r) => r.score))).toBe(1);
    expect(Math.min(...ranked.map((r) => r.score))).toBe(0);
  });
});

describe('hybrid scoring', () => {
  const now = Date.now();

  it('weights sum to 1', () => {
    const total = Object.values(RANK_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('blends components into a bounded score', () => {
    const score = hybridScore({ semantic: 1, keyword: 1, project: 1, recency: 1, entity: 1 });
    expect(score).toBeCloseTo(1, 5);
    expect(hybridScore({ semantic: 0, keyword: 0, project: 0, recency: 0, entity: 0 })).toBe(0);
    expect(hybridScore({ semantic: 0.5, keyword: 0.5, project: 0.5, recency: 0.5, entity: 0.5 })).toBeCloseTo(0.5, 5);
  });

  it('prefers a strong semantic + project match over a weak keyword-only match', () => {
    const strong = hybridScore({ semantic: 0.9, keyword: 0.2, project: 1, recency: 0.5, entity: 1 });
    const weak = hybridScore({ semantic: 0.2, keyword: 0.6, project: 0, recency: 0.5, entity: 0 });
    expect(strong).toBeGreaterThan(weak);
  });

  it('decays recency with age', () => {
    const fresh = recencyScore(new Date(now), now);
    const old = recencyScore(new Date(now - 90 * 86_400_000), now);
    expect(fresh).toBeGreaterThan(old);
    expect(old).toBeGreaterThanOrEqual(0);
  });

  it('credits entity overlap, case-insensitively', () => {
    expect(entityScore(['NEXUS'], 'Nexus launch brief')).toBeGreaterThan(0);
    expect(entityScore(['NEXUS'], 'unrelated quarterly report')).toBe(0);
  });

  it('explains provenance in plain language', () => {
    const text = explain({ semantic: 0.82, keyword: 1, project: 0, recency: 0.7, entity: 1 });
    expect(text.toLowerCase()).toContain('semantic');
    expect(text.toLowerCase()).toContain('keyword');
    expect(text.toLowerCase()).toContain('entities');
  });
});
