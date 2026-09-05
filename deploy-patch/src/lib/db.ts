import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { log } from './logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * `next build` instantiates route modules to collect page data. Prisma validates
 * the datasource URL when the client is constructed, so a build with no database
 * configured must still get a syntactically valid URL of the right *provider* —
 * otherwise the build fails before the runtime ever sees the real connection
 * string. The provider is recorded by scripts/prisma.mjs at generate time.
 */
function buildPlaceholderUrl(): string | null {
  // Set by scripts/build.mjs, which also exports DATABASE_URL to every worker.
  if (process.env.NEXUS_SKIP_DB_PROBE !== '1') return null;
  let provider = 'postgresql';
  try {
    provider = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.generated.provider'), 'utf8').trim();
  } catch {
    /* default to postgresql */
  }
  return provider === 'sqlite'
    ? 'file:./.build-placeholder.db'
    : 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
}

function assertDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return;

  const placeholder = buildPlaceholderUrl();
  if (placeholder) {
    usingPlaceholder = true;
    process.env.DATABASE_URL = placeholder;
    return;
  }

  throw new Error(
    [
      'DATABASE_URL is not set — NEXUS cannot open a database.',
      '',
      'On Render: link the Postgres database to this service',
      '(render.yaml already declares  envVars: DATABASE_URL → fromDatabase: nexus-db)',
      'and redeploy. Render only injects the connection string into services that',
      'declare it, so a service created outside the Blueprint will not have it.',
      'Locally: copy .env.production.example values into .env.',
    ].join('\n'),
  );
}

let usingPlaceholder = false;

function createClient(): PrismaClient {
  assertDatabaseUrl();
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  // Probing a connection during `next build` would only produce a misleading
  // "can't reach database server" error for a URL that is never meant to open.
  if (process.env.NEXUS_SKIP_DB_PROBE !== '1') {
    client.$connect().catch((e) => log.error('prisma connect failed', { error: String(e) }));
  }
  return client;
}

/** Single shared PrismaClient (prevents connection exhaustion in dev HMR). */
export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
