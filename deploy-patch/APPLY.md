# Landing the deploy fix in your repo

Render builds from your connected Git repo, and the fix is not in it yet. These 8 files
are the entire deploy-critical change — copy them over your local clone, commit, push,
then **Manual Deploy → Clear build cache & deploy**.

```
deploy-patch/
├── package.json          build/start scripts; postinstall generator REMOVED
├── next.config.mjs       unchanged, included for completeness
├── render.yaml           Blueprint (web + Postgres 16 + disk + cron worker)
├── vercel.json           daily cron (Hobby-safe)
├── scripts/
│   ├── prisma.mjs        provider resolution + placeholder + provider marker
│   ├── build.mjs         NEW — exports a valid URL to every Next build worker
│   └── worker.ts         NEW — queue drain for Render cron (`npm run worker`)
└── src/lib/db.ts         build-phase placeholder + actionable runtime error
```

```bash
cp -r /path/to/deploy-patch/* /path/to/your/nexus-clone/
cd /path/to/your/nexus-clone
git add -A && git commit -m "Build without database env vars; Render blueprint"
git push
```

Everything else in the app (src/features, src/app, src/components, tests) is unchanged by
this fix — if you want the whole tree instead, use `nexus-deploy-update.tgz` (275 KB) in
the workspace root.

## What each change does

1. **`postinstall` removed** — `npm install` can no longer fail on database config. This
   was the direct cause of `npm error code 1 … sh -c node scripts/prisma.mjs generate`.
2. **`scripts/prisma.mjs`** — resolves the provider from `DATABASE_URL` first (URL beats a
   stale `NEXUS_DB_PROVIDER`), then the env var, then defaults to PostgreSQL. Writes the
   resolved provider to `prisma/schema.generated.provider`. Never exits non-zero over
   missing config — it warns.
3. **`scripts/build.mjs`** — when `DATABASE_URL` is absent, exports a provider-matching
   placeholder URL *and* `NEXUS_SKIP_DB_PROBE=1` to every Next worker, so build-time page
   data collection cannot fail on an unreachable database.
4. **`npm start`** — regenerates the Prisma client from the real `DATABASE_URL` before
   booting Next, so any placeholder is replaced at runtime.
5. **`src/lib/db.ts`** — with no `DATABASE_URL` at runtime, static pages still serve and
   data routes log: `DATABASE_URL is not set — NEXUS cannot open a database.` plus the
   Render step to fix it.

## Verified here

- `env -u DATABASE_URL -u NEXUS_DB_PROVIDER npm run build` → **exit 0**, 43/43 pages, no
  Prisma errors (fresh install, no `postinstall`).
- `npm run build` with SQLite → exit 0. `npm run typecheck` clean. 46/46 tests pass.
- Runtime with no `DATABASE_URL`: `/login` → 200, `/api/health` logs the fix.
- `PORT=10000 npm run start` → binds `0.0.0.0:10000` (Render's port).

## Still required after it builds

The build no longer *depends* on the database, but the app still needs one to serve data.
On the service → **Environment**:

| Key | Value |
|---|---|
| `DATABASE_URL` | Internal Database URL from your Postgres instance |
| `NEXUS_DB_PROVIDER` | `postgresql` |
| `NEXUS_SESSION_SECRET` | `openssl rand -hex 32` |
| `NEXUS_STORAGE_DRIVER` | `local` |
| `NEXUS_STORAGE_DIR` | `/var/data/nexus-storage` |
| `NODE_VERSION` | `22` |

Then, once it's live, seed the demo workspace once from the Render Shell:

```bash
npx tsx prisma/seed.ts
```
