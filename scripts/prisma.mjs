#!/usr/bin/env node
/**
 * Prisma CLI wrapper that targets the schema for the configured database.
 *
 * NEXUS ships one data model. The only difference between the SQLite (local) and
 * PostgreSQL (Vercel / production) variants is the datasource provider — the app
 * stores embeddings as JSON and ranks in application code, so no `Unsupported()`
 * columns are required to run on Postgres.
 *
 *   node scripts/prisma.mjs generate
 *   node scripts/prisma.mjs db push --skip-generate
 *   node scripts/prisma.mjs migrate deploy
 *
 * The resolved schema is written to prisma/schema.generated.prisma (git-ignored)
 * so the tracked schema file is never rewritten at build time.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provider = (process.env.NEXUS_DB_PROVIDER ?? 'sqlite').toLowerCase();
const isPostgres = provider === 'postgresql' || provider === 'postgres';

const source = path.join(root, 'prisma', 'schema.prisma');
// Written beside the source schema on purpose: SQLite resolves `file:./dev.db`
// relative to the schema directory, so a subfolder would silently relocate the
// database file.
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

const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
const args = [...process.argv.slice(2), '--schema', outFile];

console.log(`[prisma] provider=${isPostgres ? 'postgresql' : 'sqlite'} schema=prisma/schema.generated.prisma`);

try {
  execFileSync(bin, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NEXUS_DB_PROVIDER: provider } });
} catch (error) {
  process.exit(error.status ?? 1);
}
