# NEXUS Technical Architecture

## Stack
NEXUS runs on Next.js with the App Router, TypeScript in strict mode, Tailwind CSS and a PostgreSQL database accessed through Prisma. Vector similarity search uses pgvector, giving semantic retrieval directly inside the primary database.

## Intelligence layer
The AI layer sits behind a provider abstraction. Every model call passes through one function that handles retries, timeouts, structured output validation, token accounting, latency tracking and telemetry persistence. When no external model credential exists, a deterministic local engine performs the same role and every call is flagged as simulated.

## Retrieval
Retrieval is hybrid. A query is embedded once and compared against pgvector indexes for document chunks, knowledge items and memories. In parallel, PostgreSQL full-text ranking produces a keyword candidate set. Both candidate sets are merged and rescored with recency, project relevance and entity overlap. Every returned item carries its score components and a provenance explanation.

## Orchestration
Execution is modelled as a directed acyclic graph. The orchestrator resolves dependency levels, runs independent branches concurrently, persists a child run per step, and halts the entire run when a tool call requires approval. State survives the halt, so approval resumes the same graph rather than restarting it.

## Security
Authentication uses http-only signed session cookies with server-side session records. Integration credentials are encrypted at rest and never serialised to clients. Every mutating request is checked for same-origin, validated with a schema, and rate limited. Approval and permission decisions are written to an audit log.