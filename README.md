# NEXUS

**Your digital world. One intelligent system.**
**Think. Connect. Act.**

NEXUS is an intelligent operating layer: you state an outcome, and it understands the request, retrieves the
context that matters, reasons about a plan, orchestrates specialised agents, selects and invokes tools, stops for
approval when an action needs your authority, validates the result and remembers what mattered.

It is running right now in this workspace. Sign in with **demo@nexus.ai / nexus-demo-2026** and type
`Prepare my NEXUS launch for this week.` into Command.

---

## What genuinely works

The acceptance path is real end to end — every step below is persisted to PostgreSQL and visible in the UI:

```
COMMAND → INTENT → CONTEXT → PLAN → AGENT ORCHESTRATION → TOOL SELECTION
        → PERMISSION → APPROVAL → EXECUTION → VALIDATION → RESULT → MEMORY
```

| Capability | Implementation |
| --- | --- |
| Intent Engine | Rule-based NLP parses objective, deadline (`this week`, dates, weekdays), capabilities, risk and required permissions. Schema-validated before use. |
| Context Engine | Hybrid retrieval: pgvector cosine similarity **+** PostgreSQL full-text ranking **+** project, recency and entity scoring. Every item carries score components and a "why selected" provenance line. |
| Orchestrator | Real DAG. Dependency levels run in parallel, dependents wait, approvals halt the graph, failures are contained to their branch, and state survives halt/resume. |
| Agents | 7 agents (planning, research, knowledge, execution, review, creative, analyst) with capabilities, allowed tools, permission ceilings and per-run telemetry. |
| Tools | 23 schema-validated tools across WEB, DOCUMENTS, KNOWLEDGE, PROJECTS, TASKS, FILES, CALENDAR, EMAIL, GITHUB, DATA_ANALYSIS, MEMORY and ARTIFACT_GENERATION. |
| Permissions | READ · WRITE · EXTERNAL_ACTION · HIGH_IMPACT. Writes and above always stop for approval. External tools refuse outright when their integration is not connected. |
| Approvals | Approve / Deny / Modify. Modifying rewrites the tool input before execution. Nothing executes before a decision. |
| Documents | Upload PDF/DOCX/TXT/MD/CSV → validate → extract → chunk → embed (pgvector) → index → knowledge graph. Failures are recorded, never hidden. |
| Memory | Four layers (short-term, project, long-term, explicit) with confidence, importance, scope, lifecycle expiry and full user control. |
| Workflows | Visual builder with React Flow: trigger, agent, tool, condition, approval, delay, branch, loop and output nodes. Versioned, validated, executable, observable. |
| Observability | Per-run inspection of events, tool I/O, model calls (tokens, latency, provider, simulated flag), approvals, artifacts and errors. |

### The launched demo, run for real

The seeded workspace contains the NEXUS Launch project, five indexed documents (11 embedded chunks), six tasks,
seven authored knowledge items — twelve in total once the items derived from the indexed documents are counted —
six knowledge relations and five memories. Running `Prepare my NEXUS launch for this week.` produces —
deterministically, from real rows:

```
objective : launch
deadline  : this week → resolved to a real date
context   : 12 relevant items, confidence 0.58
graph     : planning → research → knowledge → execution → review
approvals : 2 (tasks.schedule, projects.update) — both halt execution
result    : 6 tasks · 3 recommendations · 2 approvals · 6 evidence findings · artifact · 2 memories
```

Reproduce it over HTTP at any time:

```bash
npm run demo            # scripts/acceptance.sh — 9 stages, all against the live API
```

---

## Demo mode: what is simulated, and what is not

NEXUS runs without any external model credential. When `OPENAI_API_KEY` is empty the app enters **DEMO MODE** and
the AI provider abstraction selects `MockProvider` — a deterministic local inference engine.

| Layer | DEMO MODE |
| --- | --- |
| Language understanding, plan drafting, copy generation | **Simulated** by the deterministic engine. Every call is flagged `simulated: true`, persisted in `ModelCall`, and labelled in Settings → AI and Observability. |
| Retrieval (pgvector + full text) | **Real.** |
| Intent parsing, deadline resolution, entity matching | **Real** (rule-based, deterministic, resolved against the database). |
| Agent selection, DAG scheduling, parallelism | **Real.** |
| Tool calls, database writes, task/project updates | **Real.** |
| Permission checks and approvals | **Real.** |
| Validation, recommendations, artifacts, memory | **Real.** |
| Document ingestion and embeddings | **Real** (deterministic hashing embeddings, 512-d, L2-normalised). |
| Web search and integration calls | **Refused, not faked.** `web.search` fails with "no search provider configured" and the run records the gap instead of inventing sources. |

Presentation pacing (`NEXUS_PACING_MS`, default 260 ms) inserts a short pause *between* real state transitions so
the UI can animate them. It never fabricates work; set it to `0` to remove it entirely.

Add `OPENAI_API_KEY` to `.env` and everything above switches to `OpenAIProvider` — streaming, structured output
validation, tool calling and hosted embeddings — with no code changes.

---

## Architecture

```
src/
├── app/
│   ├── (auth)/login                  sign-in (password or one-click demo session)
│   ├── (app)/                        authenticated shell
│   │   ├── page.tsx                  dashboard: what's happening / needs attention / recommended next
│   │   ├── command/                  COMMAND — the heart of NEXUS
│   │   ├── projects/[id]/            project intelligence: objective, health, work, knowledge, runs
│   │   ├── knowledge/                knowledge graph (force-directed, from real relations)
│   │   ├── documents/                upload + ingestion pipeline + chunk inspector
│   │   ├── tasks/                    kanban with agent/ user provenance
│   │   ├── workflows/[id]/           visual workflow builder (React Flow)
│   │   ├── agents/[id]/              agent configuration, tools, run history
│   │   ├── approvals/                approve / deny / modify
│   │   ├── runs/[id]/                full run inspection
│   │   ├── activity/ notifications/ search/ integrations/ settings/
│   └── api/                          40+ route handlers, one error schema, zod-validated
├── components/
│   ├── ui/                           design primitives (shadcn-style, built on Radix)
│   ├── shell/                        sidebar, topbar, command palette (⌘K), mobile nav
│   └── layout/ features/
├── lib/
│   ├── ai/                           provider abstraction: MockProvider · OpenAIProvider · telemetry
│   ├── agents/                       7 agents + registry
│   ├── orchestration/                DAG engine, workflow interpreter, validation, pacing
│   ├── tools/                        registry + 23 tool definitions with zod schemas
│   ├── permissions/ memory/ retrieval/ storage/ jobs/ events/ auth/
└── server/pipeline/                  intent engine, run service, approvals, finalization, recovery
```

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 · Prisma 6 · PostgreSQL 17 +
pgvector · Framer Motion · Radix · TanStack Query · Zustand · vitest.

**Data model:** 30+ models — User, Workspace, Membership, Session, Project, ProjectMember, Task, TaskDependency,
Milestone, Document, DocumentChunk (vector(512)), KnowledgeItem (vector(512)), KnowledgeRelation, Memory
(vector(512)), Conversation, Message, Intent, Agent, AgentRun, RunEvent, ModelCall, Tool, ToolExecution,
Workflow, WorkflowNode, WorkflowEdge, WorkflowRun, Approval, Activity, Integration, Notification, Artifact,
AuditLog, UserPreference, NotificationPrefs — with indexes on every retrieval-heavy path and cascades on
ownership.

---

## Running it

```bash
bash scripts/bootstrap.sh     # full machine setup (Postgres + pgvector + seed + build + start)
```

Or, in a workspace that already has PostgreSQL:

```bash
npm install
cp .env.example .env          # point DATABASE_URL at your server
npx prisma db push && npx prisma generate
npx tsx prisma/seed.ts        # ingests and embeds the seed corpus
npm run build && npm start
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run db:push` / `db:seed` / `db:studio` | Schema, seed corpus, Prisma Studio |
| `npm test` | 32 tests: intent, retrieval, permissions, tools, approvals, memory, ingestion, workflow, full acceptance |
| `npm run demo` | Drive the acceptance scenario against the live API |

---

## Security

- Sessions: http-only, same-site signed cookies backed by server-side session rows.
- Passwords: scrypt with per-password salts.
- Integration credentials: AES-256-GCM encrypted at rest, never serialised to the client.
- Every mutating request: same-origin (CSRF) check, zod validation, rate limiting, audit log entry.
- Authorisation: workspace scoping on every query; agent tool calls limited to each agent's allow-list.
- Structured output is validated against a zod schema before it is trusted; failures fall back and are recorded.

---

## Non-negotiables honoured

- **No fake AI.** No simulated progress bars, invented sources or fabricated metrics. Every number in the UI comes
  from a database row.
- **No dead buttons.** Every primary control performs a real action, opens a functional interface, or explains
  exactly what configuration is missing.
- **Real state.** Projects, tasks, documents, knowledge, memories, conversations, agents, runs, workflows,
  approvals, activities, integrations, artifacts and notifications all persist.
- **User control.** AI recommends and prepares; you authorise. HIGH_IMPACT can never be auto-approved.
- **No hidden chain of thought.** The timeline shows execution events (`Retrieved 6 relevant document excerpts`,
  `Execution Agent waiting for approval`) — never hidden reasoning.
