/**
 * Centralised, validated environment access.
 * Secrets are read server-side only — never import this into a client component.
 */
/** Server-side only. Never import this module from a client component. */
function str(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}
function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

export const env = {
  dbProvider: str('NEXUS_DB_PROVIDER', 'sqlite') as 'sqlite' | 'postgresql',
  databaseUrl: str('DATABASE_URL', 'file:./dev.db'),
  sessionSecret: str('NEXUS_SESSION_SECRET', 'nexus-dev-secret'),
  aiProvider: str('NEXUS_AI_PROVIDER', 'mock') as 'mock' | 'openai' | 'anthropic' | 'ollama',
  aiModel: str('NEXUS_AI_MODEL', 'gpt-4o-mini'),
  embedProvider: str('NEXUS_EMBED_PROVIDER', 'local') as 'local' | 'openai',
  embedModel: str('NEXUS_EMBED_MODEL', 'nexus-local-384'),
  embedDimensions: num('NEXUS_EMBED_DIMENSIONS', 384),
  storageDriver: str('NEXUS_STORAGE_DRIVER', 'local') as 'local' | 's3',
  storageDir: str('NEXUS_STORAGE_DIR', '.nexus-storage'),
  jobDriver: str('NEXUS_JOB_DRIVER', 'inline') as 'inline' | 'queue',
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || '',
  isProduction: process.env.NODE_ENV === 'production',
} as const;

/** True when the language model is substituted by a deterministic local provider. */
export function isDemoMode(): boolean {
  return env.aiProvider === 'mock';
}
