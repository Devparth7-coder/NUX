/**
 * Hybrid ranking (§7):
 *
 *   relevance = w_semantic·semantic + w_keyword·keyword
 *             + w_project·project   + w_recency·recency + w_entity·entity
 *
 * Every component returns 0..1 and is computed from real records. The output
 * always carries the component breakdown so the UI can show *why* an item was
 * selected — no unexplained ranking.
 */

export const RANK_WEIGHTS = {
  semantic: 0.34,
  keyword: 0.24,
  project: 0.14,
  recency: 0.12,
  entity: 0.16,
} as const;

export function hybridScore(components: {
  semantic: number;
  keyword: number;
  project: number;
  recency: number;
  entity: number;
}): number {
  const raw =
    RANK_WEIGHTS.semantic * components.semantic +
    RANK_WEIGHTS.keyword * components.keyword +
    RANK_WEIGHTS.project * components.project +
    RANK_WEIGHTS.recency * components.recency +
    RANK_WEIGHTS.entity * components.entity;
  return Math.max(0, Math.min(1, raw));
}

/** Exponential decay: 1.0 today → ~0.36 after 30 days → ~0.13 after 90 days. */
export function recencyScore(date: Date | string | null | undefined, now = Date.now(), halfLifeDays = 21): number {
  if (!date) return 0.2;
  const t = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  if (!Number.isFinite(t)) return 0.2;
  const ageDays = Math.max(0, (now - t) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** Fraction of query entities whose name appears in the candidate text. */
export function entityScore(entityNames: string[], candidateText: string): number {
  if (!entityNames.length) return 0;
  const haystack = candidateText.toLowerCase();
  let hits = 0;
  for (const name of entityNames) {
    const n = name.toLowerCase().trim();
    if (n.length > 2 && haystack.includes(n)) hits++;
  }
  return hits / entityNames.length;
}

export function explain(scores: {
  semantic: number;
  keyword: number;
  project: number;
  recency: number;
  entity: number;
}): string {
  const parts: string[] = [];
  if (scores.semantic > 0.35) parts.push(`strong semantic match (${scores.semantic.toFixed(2)})`);
  else if (scores.semantic > 0.12) parts.push(`semantic overlap (${scores.semantic.toFixed(2)})`);
  if (scores.keyword > 0.4) parts.push(`keyword match (${scores.keyword.toFixed(2)})`);
  if (scores.entity > 0) parts.push(`mentions ${Math.round(scores.entity * 100)}% of the entities in your request`);
  if (scores.project > 0.6) parts.push('belongs to the project in scope');
  if (scores.recency > 0.6) parts.push('recently updated');
  return parts.length ? `Selected because: ${parts.join('; ')}.` : 'Retrieved by metadata filtering only.';
}
