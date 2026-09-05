#!/usr/bin/env node
/**
 * Prisma CLI wrapper that targets the schema for the configured database.
 *
 * NEXUS ships one data model. The only difference between the SQLite (local) and
 * PostgreSQL (Render / Vercel / production) variants is the datasource provider —
 * the app stores embeddings as JSON and ranks in application code, so no
 * `Unsupported()` columns are required to run on Postgres.
 *
 *   node scripts/prisma.mjs generate
 *   node scripts/prisma.mjs db push --skip-generate
 *
 * The resolved schema is written to prisma/schema.generated.prisma (git-ignored)
 * so the tracked schema file is never rewritten at build time. It sits *beside*
 * the source schema because SQLite resolves `file:./dev.db` relative to the
 * schema directory — a subfolder would silently relocate the database.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimal .env loader. The Prisma CLI loads .env itself, but this script needs
 * DATABASE_URL *before* it shells out, and npm does not load .env for us.
 */
function loadDotEnv() {
  for (const file of ['.env', '.env.local']) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith('#')) continue;
      const key = match[1];
      const value = match[2].replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadDotEnv();
const url = process.env.DATABASE_URL ?? '';

/**
 * Provider resolution, most specific first:
 *   1. explicit NEXUS_DB_PROVIDER
 *   2. inferred from the DATABASE_URL scheme
 *   3. sqlite (local default)
 *
 * Inference matters on Render: build-time env vars are not guaranteed to be the
 * same set as runtime ones, so trusting the URL catches cases where
 * NEXUS_DB_PROVIDER is missing but Postgres is wired up.
 */
function resolveProvider() {
  // The URL is ground truth: a postgres:// connection string with a stale
  // NEXUS_DB_PROVIDER=sqlite must still produce a Postgres client.
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return 'postgresql';
  if (url.startsWith('file:')) return 'sqlite';

  const configured = (process.env.NEXUS_DB_PROVIDER ?? '').toLowerCase();
  if (configured === 'postgresql' || configured === 'postgres') return 'postgresql';
  if (configured === 'sqlite') return 'sqlite';

  return null;
}

let provider = resolveProvider();
let placeholder = false;

if (!provider) {
  // Nothing configured. `prisma generate` only needs a syntactically valid URL,
  // never a reachable database, so do not break the build over this: pick the
  // provider that fits the environment and let the runtime regenerate.
  // Production-first: the URL (loaded from .env locally) decides everywhere it
  // is available, so this default only applies to build environments where the
  // database has not been wired up yet.
  provider = 'postgresql';
  console.warn(
    [
      `[prisma] WARNING: neither DATABASE_URL nor NEXUS_DB_PROVIDER is set — assuming "${provider}".`,
      '        The correct client is regenerated at boot (npm start), so this only affects build-time types.',
      '        On Render: link the Postgres database so DATABASE_URL is injected into the service.',
    ].join('\n'),
  );
}

if (provider === 'postgresql' && !url) {
  // Prisma validates the URL shape even though it never connects during generate.
  placeholder = true;
  process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
  console.warn('[prisma] WARNING: generating with a placeholder Postgres URL; the real one is applied at boot.');
}

const isPostgres = provider === 'postgresql';

const source = path.join(root, 'prisma', 'schema.prisma');
const outFile = path.join(root, 'prisma', 'schema.generated.prisma');

let schema = fs.readFileSync(source, 'utf8');
if (isPostgres) {
  schema = schema.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
  if (!/provider\s*=\s*"postgresql"/.test(schema)) {
    console.error('[prisma] could not switch datasource provider to postgresql');
    process.exit(1);
  }
}
fs.writeFileSync(outFile, schema);
// Read by src/lib/db.ts when it must start without a real DATABASE_URL (Next
// collects page data at build time and instantiates the client to do it).
fs.writeFileSync(path.join(root, 'prisma', 'schema.generated.provider'), provider);

console.log(
  `[prisma] provider=${provider} schema=prisma/schema.generated.prisma url=${url ? url.replace(/\/\/[^@]*@/, '//***@') : placeholder ? '(placeholder)' : '(unset)'}`,
);

const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
const args = [...process.argv.slice(2), '--schema', outFile];

try {
  execFileSync(bin, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NEXUS_DB_PROVIDER: provider } });
} catch (error) {
  process.exit(error.status ?? 1);
}
