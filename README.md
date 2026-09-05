# NEXUS — Your digital world. One intelligent system.

**THINK. CONNECT. ACT.**

An intelligent operating layer for your work — not a chatbot, not a task manager, not another SaaS dashboard.
You type what you want in plain language; NEXUS understands the intent, retrieves what it genuinely knows,
plans the work, runs specialised agents, calls real tools, stops for your approval before anything sensitive,
validates the outcome, and remembers it.

```
COMMAND → INTENT → CONTEXT → PLAN → AGENT ORCHESTRATION → TOOL SELECTION →
PERMISSION → APPROVAL → EXECUTION → VALIDATION → RESULT → MEMORY
```

---

## 1. The honesty contract

| Rule | How it is implemented |
|---|---|
| **No fake AI** | With no API key configured, NEXUS runs in **DEMO MODE**: the only thing substituted is the language model (`MockProvider`, deterministic, composes from your real database values). Every response, artifact and event is tagged `mode: "DEMO"`. Intent parsing, retrieval, planning, orchestration, tool execution, permissions, approvals, validation and persistence are the **same code paths** that run against a live provider. Add a key to `.env` and restart — nothing else changes. |
| **No dead buttons** | Every primary control writes to the database, starts a real run, or explains precisely what configuration is missing (see the Integrations connect flow). |
| **Real state** | 35 Prisma models. Projects, tasks, documents + chunks, knowledge, memories, conversations, agents, agent runs, run events, tool executions, workflows, approvals, activities, integrations, artifacts and notifications are all persisted. Nothing is held only in React state. |
| **User control** | Four permission levels (`READ → WRITE → EXTERNAL_ACTION → HIGH_IMPACT`). `authorize()` in `src/lib/permissions/engine.ts` is the single gate every tool call passes through. An approval is granted **for the action you approved** — not for every later action of that class. |
| **No hidden chain-of-thought** | Agents emit *execution events only* (`RunEvent` rows: tool invoked, tool result, approval requested, artifact written). There is no private reasoning surface anywhere in the product. |
| **No invented sources** | Retrieval returns real rows with provenance and a plain-language rationale (`Selected because: strong semantic match (0.74); belongs to the project in scope…`). When the corpus has nothing, the research report says so. |

---

## 2. Running it

```bash
npm install
npm run setup          # prisma db push + deterministic seed
npm run dev            # http://localhost:3000
```

**Demo login:** `demo@nexus.ai` / `nexus-demo-2026`

Other scripts: `npm run build`, `npm run start`, `npm run typecheck`, `npm run db:reset`,
`npx tsx scripts/demo-run.ts "<command>"` (headless pipeline trace),
`BASE=http://127.0.0.1:3000 npx tsx scripts/acceptance.ts "<command>"` (end-to-end HTTP run).

### Switching out of DEMO MODE

```bash
NEXUS_AI_PROVIDER="openai"      # or anthropic | ollama
OPENAI_API_KEY="sk-…"
NEXUS_EMBED_PROVIDER="openai"   # switches embeddings from the offline 384-d model to text-embedding-3-small
```

The badge in the sidebar flips from **DEMO** to **LIVE**, and `/api/health` reports the provider.

### PostgreSQL + pgvector

`prisma/schema.postgres.prisma` is the production twin of the SQLite schema (vector columns, pgvector index).
Set `NEXUS_DB_PROVIDER="postgresql"` and a `DATABASE_URL`, then push that schema. No PostgreSQL server was
available in this environment, so the runtime here is SQLite — the schema file is provided, not silently faked.

---

## 3. What is in the box

**Stack** — Next.js 16 (App Router, route handlers) · React 19 · TypeScript (strict) · Tailwind ·
shadcn-style primitives in `src/components/ui` · Framer Motion · Lucide · Zustand · TanStack Query ·
Prisma · Zod.

**18 pages** — HOME, COMMAND, PROJECTS (+ workspace), KNOWLEDGE, DOCUMENTS (+ inspector), TASKS,
WORKFLOWS (visual builder), AGENTS, ACTIVITY, SEARCH, APPROVALS, NOTIFICATIONS, INTEGRATIONS,
MEMORY, SETTINGS, RUN DETAIL, LOGIN.

**46 API routes** — auth, command, intents (+ SSE event stream, cancel), approvals (+ decide), projects,
tasks, documents (+ upload, download), knowledge, memory, agents (+ single-agent run), agent runs, tools
(+ execute), workflows (+ run), search, artifacts (+ download), activity, notifications, integrations
(+ connect/disconnect), conversations, settings, stats, health.

**7 agents** — Planning, Research, Knowledge, Execution, Review, Creative, Analyst. Each declares
capabilities, a tool allowlist and a permission ceiling; the tool registry rejects anything outside the allowlist.
They run as a dependency DAG: `planning → (research ∥ knowledge) → (analyst ∥ creative) → execution → approval → review → validation → result`.

**25 tools** — documents (3), knowledge (3), projects (4), tasks (4), web (2), external (4), artifacts (1),
analysis (2), files (2). Each declares its permission level and, where relevant, a required integration.

**Retrieval** — 384-d offline hashing embedder (swaps to OpenAI when a key exists) + BM25-style keyword +
project/recency/entity signals, weighted `.34/.24/.14/.12/.16` with an `explain()` provenance string.
Hybrid search over document chunks and knowledge; every retrieved item is persisted as a `ContextItem` on the intent.

**Visual workflow builder** — TRIGGER, AGENT, TOOL, CONDITION, APPROVAL, DELAY, BRANCH, LOOP, OUTPUT nodes;
drag to arrange, link to connect, per-node inspector, saved and versioned with validation feedback, then executed
by the same workflow engine that powers approvals.

**Memory** — four layers (WORKING / SHORT_TERM / LONG_TERM / EXPLICIT) with importance, pinning, decay,
near-duplicate upsert (cosine > 0.93) and lifecycle pruning.

---

## 4. Acceptance run

```
CMD  "Prepare my NEXUS launch for this week."
MODE DEMO · provider mock · 25 tools · 7 agents

1-2  INTENT        objective "NEXUS launch" · deadline "This week (Friday 18:00)" · risk HIGH · confidence 0.93
3    CONTEXT       12 items retrieved with scores + rationale (knowledge, project, memory, document, chunks, tasks, activity)
4-6  PLAN/GRAPH    Planning 53ms · Research 798ms · Knowledge 68ms · Execution (holds) · Review queued
7-9  EXECUTION     20 tool calls · 2 EXTERNAL_ACTION gates raised → run pauses
10   TIMELINE      65 live events streamed over SSE
11-14 APPROVAL     user approves email.draft, then calendar.create (each one-shot)
15-20 RESULT       6 tasks · 3 recommendations · validation PASSED 5/5 · 5 artifacts · 3 memory writes
```

Result payload: **6 Tasks / 3 Recommendations / 2 Actions Require Approval** — the tasks are *reconciled*
against the six seeded tasks (deadlines and priorities updated, not duplicated), the recommendations are
derived from real project health (unowned tasks, blocked dependencies, deadline window), and the two
approvals are genuinely blocking: the run cannot finish until you decide.

---

## 5. Deploying to Vercel

NEXUS is a standard Next.js 16 app and deploys to Vercel as-is, with three production
requirements: a Postgres database, object storage, and enough function duration for an
agent run.

```bash
# once
vercel link                      # or: vercel --prod after `git init` + push
vercel env pull                  # or paste the vars from .env.production.example
npm run db:push                  # creates the schema in Postgres (NEXUS_DB_PROVIDER=postgresql)
npx tsx prisma/seed.ts           # optional: seed the demo workspace

# deploy
vercel --prod
```

**Environment variables** — copy `.env.production.example` into Vercel → Settings →
Environment Variables. The required ones:

| Variable | Why |
|---|---|
| `NEXUS_DB_PROVIDER=postgresql` + `DATABASE_URL` (+ `DIRECT_URL` for migrations) | SQLite cannot work on Vercel — the filesystem is ephemeral. |
| `NEXUS_SESSION_SECRET` | HMAC key for session cookies. `openssl rand -hex 32`. |
| `NEXUS_STORAGE_DRIVER=s3` + S3/R2 credentials | Uploaded documents must live outside the function filesystem. |
| `CRON_SECRET` | Authenticates the scheduled queue worker (`/api/cron/jobs`). |
| `OPENAI_API_KEY` | Optional. Without it NEXUS runs in DEMO MODE, which is honest and fully functional. |

**What was made deployable**

- `scripts/prisma.mjs` resolves the schema for the configured provider and writes it to
  `prisma/schema.generated.prisma` (git-ignored, same directory so SQLite paths resolve as
  before). `NEXUS_DB_PROVIDER=postgresql npm run build` generates a Postgres client from the
  same data model — **validated**: `prisma validate` passes for the PostgreSQL variant.
  Embeddings stay JSON-encoded and ranking happens in application code, so no pgvector
  column or raw-SQL retrieval layer is required to run on Postgres.
- Agent runs are scheduled with Next's `after()` (`/api/command`), so the pipeline survives
  the response on serverless instead of being frozen mid-flight.
- `vercel.json` registers a 10-minute cron for `/api/cron/jobs`, which drains queued jobs
  when `NEXUS_JOB_DRIVER=queue`. The endpoint rejects any request without `CRON_SECRET`.
- `postinstall` runs `prisma generate`, so the client is always built for the target database.

**Known limits on Vercel**

- Hobby caps functions at 60s. A full pipeline run takes 5–15s, so it fits; raise the
  route's `maxDuration` on Pro if you add heavier agents.
- `prisma/schema.postgres.prisma` (pgvector, HNSW indexes, tsvector) remains the documented
  upgrade path. It is **not wired** — the repository has no raw-SQL vector retrieval layer
  yet, and no PostgreSQL server existed in this environment to validate one. Deploying with
  that schema today would break retrieval.

## 6. Notes

- DEMO MODE is deterministic, so the acceptance run above is reproducible for a launch video:
  `npm run db:reset` then run the command.
- Approvals time out after 15 minutes and are recorded as `EXPIRED`; the run fails loudly rather than continuing.
- Integration credentials are stored server-side in the `Integration` record and are never returned by any endpoint.
- The sidebar badge, `/api/health` and every persisted row carry the `REAL`/`DEMO` mode they were produced in.
