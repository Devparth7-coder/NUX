# NEXUS deploy fix — the build never needs a database

Your Render log is from **19:01:31**. The fix landed at **19:13**, so Render built an older
copy of the code. You can confirm from the log itself:

```
> node scripts/prisma.mjs generate && next build        ← your log (old)
> node scripts/prisma.mjs generate && node scripts/build.mjs   ← current package.json
```

## Option A — sync the new code (permanent fix)

The workspace now has a git repo with everything committed:

```bash
git remote add origin <your-repo-url>
git push -u origin main
```

Or, without git: extract **`nexus-deploy-update.tgz`** (275 KB) over your local clone,
commit, and push. It contains `src/`, `scripts/`, `prisma/schema*.prisma`, `prisma/seed.ts`,
`package.json`, `package-lock.json`, `render.yaml`, `vercel.json`, `next.config.mjs`,
`tailwind.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `tests/`, `vitest.config.ts`.

After this, the build succeeds **with or without** `DATABASE_URL`.

## Option B — unblock the current deploy right now (env vars only)

Even the old code builds fine once the provider is known. In Render → your service →
**Environment**, add:

| Key | Value |
|---|---|
| `DATABASE_URL` | Internal Database URL from your Postgres instance's Info page |
| `NEXUS_DB_PROVIDER` | `postgresql` |
| `NEXUS_SESSION_SECRET` | any long random string (`openssl rand -hex 32`) |
| `NEXUS_STORAGE_DRIVER` | `local` |
| `NEXUS_STORAGE_DIR` | `/var/data/nexus-storage` |
| `NODE_VERSION` | `22` |

Then **Manual Deploy → Clear build cache & deploy**.

## What the new code does differently

`prisma generate` only validates a URL's *shape* — it never connects. So a build should
never fail over database configuration:

1. **`scripts/prisma.mjs`** — resolves the provider from `DATABASE_URL` first (URL wins over a
   stale `NEXUS_DB_PROVIDER`), then the env var, then defaults to PostgreSQL. It records the
   provider in `prisma/schema.generated.provider`.
2. **`scripts/build.mjs`** — supplies a provider-matching placeholder URL when `DATABASE_URL`
   is absent and sets `NEXUS_SKIP_DB_PROBE=1`, exporting both to every Next build worker so
   page-data collection can't fail on an unreachable database.
3. **`npm start`** — regenerates the Prisma client from the real `DATABASE_URL` before booting
   Next, so a placeholder built at deploy time is always replaced at runtime.
4. **`src/lib/db.ts`** — if `DATABASE_URL` is genuinely missing at runtime, static pages still
   serve and data routes log the actionable message naming the Render step.

Verified in this sandbox: `env -u DATABASE_URL -u NEXUS_DB_PROVIDER npm run build` →
exit 0, 43/43 pages, no Prisma errors. And with no `DATABASE_URL` at runtime, `/login`
returns 200 while `/api/health` logs the fix.

## Still required after it builds

The database must be linked before the app can serve data — the build fix only stops the
build from depending on it. Once live, run this once in the Render Shell:

```bash
npx tsx prisma/seed.ts
```
