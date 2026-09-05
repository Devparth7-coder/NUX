type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function emit(level: Level, scope: string, message: string, meta?: unknown) {
  if (ORDER[level] < threshold) return;
  const ts = new Date().toISOString();
  const base = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  if (level === "error") console.error(base, meta ?? "");
  else if (level === "warn") console.warn(base, meta ?? "");
  else console.log(base, meta ?? "");
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, meta?: unknown) => emit("debug", scope, m, meta),
    info: (m: string, meta?: unknown) => emit("info", scope, m, meta),
    warn: (m: string, meta?: unknown) => emit("warn", scope, m, meta),
    error: (m: string, meta?: unknown) => emit("error", scope, m, meta),
  };
}

export const log = createLogger("nexus");
