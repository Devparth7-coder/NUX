/** Structured application logger. Never logs secret values. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const current: LogLevel = (process.env.NEXUS_LOG_LEVEL as LogLevel) || 'info';

const REDACT = [/api[-_]?key/i, /secret/i, /token/i, /password/i, /authorization/i];

function redact(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.some((r) => r.test(k)) ? '[redacted]' : redact(v);
  }
  return out;
}

function emit(level: LogLevel, scope: string, message: string, meta?: unknown) {
  if (LEVELS[level] < LEVELS[current]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(meta !== undefined ? { meta: redact(meta) } : {}),
  };
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify(line));
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, meta?: unknown) => emit('debug', scope, m, meta),
    info: (m: string, meta?: unknown) => emit('info', scope, m, meta),
    warn: (m: string, meta?: unknown) => emit('warn', scope, m, meta),
    error: (m: string, meta?: unknown) => emit('error', scope, m, meta),
  };
}

export const log = createLogger('nexus');
