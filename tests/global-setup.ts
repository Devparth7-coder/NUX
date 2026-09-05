/**
 * Tests run against their own SQLite file so they never touch the demo database.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export default function setup() {
  const root = path.resolve(__dirname, '..');
  for (const file of [path.join(root, 'prisma', 'test.db'), path.join(root, 'prisma', 'test.db-journal')]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  execFileSync(
    path.join(root, 'node_modules', '.bin', 'prisma'),
    ['db', 'push', '--force-reset', '--skip-generate', '--schema', 'prisma/schema.prisma'],
    { cwd: root, env: { ...process.env, DATABASE_URL: 'file:./test.db', NEXUS_DB_PROVIDER: 'sqlite' }, stdio: 'ignore' },
  );
}
