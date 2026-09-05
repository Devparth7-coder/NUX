#!/usr/bin/env node
/**
 * Build wrapper.
 *
 * `next build` loads every route module in worker processes to collect page
 * data, and Prisma validates DATABASE_URL when the client is constructed. Two
 * consequences this wrapper handles:
 *
 *   1. DATABASE_URL must exist and match the generated provider, even when the
 *      deployment database is not wired up at build time.
 *   2. The eager connection probe must be skipped — a build should never need a
 *      reachable database, and a failed probe only produces a misleading error.
 *
 * Setting the variables here means every Next worker inherits them.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let provider = 'postgresql';
try {
  provider = fs.readFileSync(path.join(root, 'prisma', 'schema.generated.provider'), 'utf8').trim();
} catch {
  /* default to postgresql */
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    provider === 'sqlite'
      ? 'file:./.build-placeholder.db'
      : 'postgresql://placeholder:placeholder@localhost:5432/placeholder';
  console.warn(`[build] DATABASE_URL unset — building with a ${provider} placeholder (replaced at boot).`);
}

process.env.NEXUS_SKIP_DB_PROBE = '1';

const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'next.cmd' : 'next');
const child = spawn(bin, ['build', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env: process.env });

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
