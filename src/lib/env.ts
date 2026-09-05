/**
 * Central environment access. Nothing here may ever be imported by client code:
 * secrets stay server-side (see src/lib/auth/session.ts for the cookie layer).
 */
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16),
  AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_PROVIDER: z.enum(["local", "openai"]).default("local"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".storage"),
  S3_BUCKET: z.string().optional().default(""),
  S3_REGION: z.string().optional().default(""),
  NEXUS_MODE: z.enum(["demo", "live"]).default("demo"),
  APP_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z.string().default("development"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

/** True when no external model provider is configured: the app runs deterministic local inference. */
export const isDemoMode =
  env.NEXUS_MODE === "demo" || env.AI_PROVIDER === "mock" || !env.OPENAI_API_KEY;

export const EMBEDDING_DIM = 512;
export const SERVER_ENV = {
  NODE_ENV: env.NODE_ENV,
  NEXUS_MODE: env.NEXUS_MODE,
  AI_PROVIDER: env.AI_PROVIDER,
  EMBEDDING_PROVIDER: env.EMBEDDING_PROVIDER,
  STORAGE_DRIVER: env.STORAGE_DRIVER,
  DEMO_MODE: isDemoMode,
  HAS_OPENAI_KEY: Boolean(env.OPENAI_API_KEY),
};
