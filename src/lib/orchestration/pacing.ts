/**
 * Presentation pacing.
 *
 * The deterministic engine is extremely fast, which would make state changes
 * invisible to a human observer. This inserts a short, configurable pause
 * BETWEEN real state transitions so the UI can animate them.
 *
 * It never fabricates work: a `pace()` call is only ever placed after a real
 * database/tool/model operation has completed. Set NEXUS_PACING_MS=0 to remove.
 */
const DEFAULT_PACING_MS = 260;

export function pacingMs() {
  const raw = Number(process.env.NEXUS_PACING_MS ?? DEFAULT_PACING_MS);
  return Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 5000) : DEFAULT_PACING_MS;
}

export function pace(multiplier = 1): Promise<void> {
  const ms = pacingMs() * multiplier;
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
