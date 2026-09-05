/**
 * NEXUS seed — creates a realistic, fully-indexed demo workspace.
 *
 * Documents are ingested through the real pipeline (extract → chunk → embed →
 * index → knowledge), so every retrieval, plan and finding in the demo is
 * grounded in actual rows in PostgreSQL + pgvector.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DEMO_EMAIL = "demo@nexus.ai";
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "nexus-demo-2026";
const USER_ID = "usr_demo_nexus";
const WORKSPACE_ID = "ws_demo_nexus";

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

const DOCUMENTS: Array<{ title: string; filename: string; body: string }> = [
  {
    title: "Product Strategy",
    filename: "product-strategy.md",
    body: `# NEXUS Product Strategy

## Positioning
NEXUS is an intelligent operating layer for a user's digital world. It is not a chatbot, not a task manager, and not a collection of AI tools. NEXUS turns intent into coordinated execution across agents, tools and data.

## Core promise
The user states an outcome. NEXUS understands the situation, retrieves the context that matters, reasons about a plan, orchestrates specialised agents, selects and invokes tools, stops for approval where required, validates the result and remembers what mattered.

## Target audience
NEXUS serves operators, founders, product leads and technical teams who already run complex digital workflows across documents, tasks, code and communication. The primary buyer is a senior individual contributor or team lead who coordinates multiple systems and wants a single authoritative layer.

## Differentiation
Three things separate NEXUS from assistant products. First, real state: every project, task, document, memory, agent run and approval is persisted and queryable. Second, real orchestration: agents are selected, scheduled and executed through a dependency graph rather than a linear prompt chain. Third, real control: permission levels gate every tool call and sensitive actions halt for human approval.

## Success criteria
Launch succeeds if a first-time user can express a real objective, watch NEXUS retrieve context and coordinate agents, approve sensitive actions, and receive a validated deliverable within a single session.`,
  },
  {
    title: "Launch Brief",
    filename: "launch-brief.md",
    body: `# NEXUS Launch Brief

## Objective
Launch NEXUS publicly this week with a credible demonstration of the complete execution pipeline.

## Launch narrative
The story is "your digital world, one intelligent system". The demonstration must show the pipeline end to end: command, intent, context, planning, agent orchestration, tool selection, permission, approval, execution, validation, result and memory.

## Sequencing
The launch sequence runs: landing page finalisation, launch video production, architecture review, announcement copy, production deployment, analytics validation. Each step must be complete before the announcement is published.

## Risks
The primary risk is a demo that looks complete but is not. Every visible number in the launch demonstration must be derived from real database state. The second risk is dependency compression: the video and analytics work both depend on the deployment completing.

## Success measures
We measure launch success by demonstration completion rate, approval requests handled without confusion, and the number of users who execute at least one intent in their first session.`,
  },
  {
    title: "Technical Architecture",
    filename: "technical-architecture.md",
    body: `# NEXUS Technical Architecture

## Stack
NEXUS runs on Next.js with the App Router, TypeScript in strict mode, Tailwind CSS and a PostgreSQL database accessed through Prisma. Vector similarity search uses pgvector, giving semantic retrieval directly inside the primary database.

## Intelligence layer
The AI layer sits behind a provider abstraction. Every model call passes through one function that handles retries, timeouts, structured output validation, token accounting, latency tracking and telemetry persistence. When no external model credential exists, a deterministic local engine performs the same role and every call is flagged as simulated.

## Retrieval
Retrieval is hybrid. A query is embedded once and compared against pgvector indexes for document chunks, knowledge items and memories. In parallel, PostgreSQL full-text ranking produces a keyword candidate set. Both candidate sets are merged and rescored with recency, project relevance and entity overlap. Every returned item carries its score components and a provenance explanation.

## Orchestration
Execution is modelled as a directed acyclic graph. The orchestrator resolves dependency levels, runs independent branches concurrently, persists a child run per step, and halts the entire run when a tool call requires approval. State survives the halt, so approval resumes the same graph rather than restarting it.

## Security
Authentication uses http-only signed session cookies with server-side session records. Integration credentials are encrypted at rest and never serialised to clients. Every mutating request is checked for same-origin, validated with a schema, and rate limited. Approval and permission decisions are written to an audit log.`,
  },
  {
    title: "Market Research",
    filename: "market-research.md",
    body: `# Market Research Summary

## Category
The market is splitting into two categories: conversational assistants that generate text, and agentic systems that take action. Buyers increasingly evaluate the second category on evidence of real execution rather than the quality of generated prose.

## Competitor patterns
Incumbent assistants optimise for single-turn quality and broad coverage. Workflow automation products optimise for deterministic triggers and integrations but lack understanding. The unmet need sits between the two: systems that understand intent and can act on it inside a persistent workspace.

## Buyer objections
The three recurring objections are trust, control and integration coverage. Buyers ask whether the system will take an action they did not authorise, whether they retain approval authority, and whether it reaches the systems they already use.

## Opportunity
The opportunity is to make control the product feature rather than the compromise: visible permission levels, explicit approvals, complete execution timelines and durable memory that the user can inspect, edit and delete.

## Evidence gaps
Primary research on willingness to pay is still outstanding. Existing evidence is drawn from competitor positioning and public product documentation rather than direct buyer interviews.`,
  },
  {
    title: "Feature Specification",
    filename: "feature-specification.md",
    body: `# NEXUS Feature Specification

## Command Center
A single large input accepts an objective. Submitting it starts the execution pipeline, not a chat response. The interface surfaces recent intent, suggested actions, active runs, projects and memory context.

## Intent Engine
Natural language is converted into a structured intent containing objective, desired outcome, entities, constraints, deadline, project context, required capabilities, risk level and required permissions. Output is schema validated before it is used.

## Agent System
Seven agents are registered: planning, research, knowledge, execution, review, creative and analyst. Each declares capabilities, allowed tools and a permission ceiling.

## Permission and approvals
Permission levels are READ, WRITE, EXTERNAL_ACTION and HIGH_IMPACT. Write actions and everything above require approval. High-impact actions always require approval. Approval records capture what will happen, why it is needed, which tool runs and what data is affected.

## Memory
Memory has four layers: short term, project, long term and explicit. Memories carry confidence, importance, scope and lifecycle metadata, and users can edit, disable or delete them.

## Workflows
Workflows are saved graphs of triggers, agents, tools, conditions, approvals, delays, branches and loops. They are versioned, validated and observable, and they reuse the same agent and tool registries as the intent pipeline.`,
  },
];

async function main() {
  const started = Date.now();
  console.log("• Seeding NEXUS workspace");

  await prisma.workspace.upsert({
    where: { id: WORKSPACE_ID },
    update: { name: "NEXUS", slug: "nexus" },
    create: { id: WORKSPACE_ID, name: "NEXUS", slug: "nexus" },
  });

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { name: "Ava Raman" },
    create: { id: USER_ID, email: DEMO_EMAIL, name: "Ava Raman", passwordHash: hashPassword(DEMO_PASSWORD) },
  });

  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: WORKSPACE_ID } },
    update: { role: "OWNER" },
    create: { userId: user.id, workspaceId: WORKSPACE_ID, role: "OWNER" },
  });

  await prisma.userPreference.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, theme: "dark", density: "comfortable", reducedMotion: false, autoApproveRead: true },
  });
  await prisma.notificationPrefs.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });

  // ── Projects ──────────────────────────────────────────────────────────────
  const launch = await prisma.project.upsert({
    where: { workspaceId_slug: { workspaceId: WORKSPACE_ID, slug: "nexus-launch" } },
    update: {},
    create: {
      workspaceId: WORKSPACE_ID,
      ownerId: user.id,
      name: "NEXUS Launch",
      slug: "nexus-launch",
      description: "Public launch of NEXUS — the intelligent operating layer.",
      objective: "Launch NEXUS publicly with a credible end-to-end demonstration",
      status: "ACTIVE",
      health: "AT_RISK",
      healthReason: "1/6 tasks complete · launch targeted this week",
      progress: 17,
      color: "#3B82F6",
      targetDate: new Date(Date.now() + 6 * 86_400_000),
    },
  });

  await prisma.project.upsert({
    where: { workspaceId_slug: { workspaceId: WORKSPACE_ID, slug: "market-intelligence" } },
    update: {},
    create: {
      workspaceId: WORKSPACE_ID,
      ownerId: user.id,
      name: "Market Intelligence",
      slug: "market-intelligence",
      description: "Ongoing competitive and buyer research for positioning.",
      objective: "Maintain an evidence base for positioning and pricing decisions",
      status: "ACTIVE",
      health: "HEALTHY",
      healthReason: "Research cadence nominal",
      progress: 45,
      color: "#8B5CF6",
      targetDate: new Date(Date.now() + 21 * 86_400_000),
    },
  });

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: launch.id, userId: user.id } },
    update: {},
    create: { projectId: launch.id, userId: user.id, role: "OWNER" },
  });

  // ── Documents (real ingestion) ────────────────────────────────────────────
  const { ingestDocument } = await import("../src/server/services/ingestion");
  const existing = await prisma.document.count({ where: { workspaceId: WORKSPACE_ID } });
  if (existing === 0) {
    for (const doc of DOCUMENTS) {
      const buffer = Buffer.from(doc.body, "utf8");
      await ingestDocument({
        workspaceId: WORKSPACE_ID,
        userId: user.id,
        projectId: launch.id,
        filename: doc.filename,
        mimeType: "text/markdown",
        buffer,
      });
      console.log(`  ✓ ingested ${doc.title}`);
    }
  } else {
    console.log("  ✓ documents already present, skipping ingestion");
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  if ((await prisma.task.count({ where: { workspaceId: WORKSPACE_ID } })) === 0) {
    const taskSeed: Array<{ title: string; description: string; status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE"; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; dueOffset: number; assignee: boolean; blockedReason?: string }> = [
      { title: "Finalize landing page", description: "Copy, hero animation and pricing block signed off.", status: "IN_PROGRESS", priority: "HIGH", dueOffset: 1, assignee: true },
      { title: "Prepare launch video", description: "90-second pipeline walkthrough with live execution footage.", status: "TODO", priority: "HIGH", dueOffset: 3, assignee: false },
      { title: "Review architecture", description: "Security review of permission engine and approval gating.", status: "DONE", priority: "MEDIUM", dueOffset: -2, assignee: true },
      { title: "Prepare announcement", description: "Launch post, changelog entry and email to the waitlist.", status: "TODO", priority: "URGENT", dueOffset: 4, assignee: false },
      { title: "Deploy production", description: "Blue-green deploy with health checks and rollback plan.", status: "TODO", priority: "URGENT", dueOffset: 5, assignee: false, blockedReason: "Waiting on architecture review sign-off" },
      { title: "Validate analytics", description: "Confirm intent execution telemetry is recorded end to end.", status: "TODO", priority: "MEDIUM", dueOffset: 6, assignee: false },
    ];

    for (const [index, t] of taskSeed.entries()) {
      await prisma.task.create({
        data: {
          workspaceId: WORKSPACE_ID,
          projectId: launch.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          dueDate: new Date(Date.now() + t.dueOffset * 86_400_000),
          assigneeId: t.assignee ? user.id : null,
          blockedReason: t.blockedReason ?? null,
          completedAt: t.status === "DONE" ? new Date(Date.now() - 2 * 86_400_000) : null,
          source: "USER",
          order: index,
        },
      });
    }

    // Real dependency: analytics validation depends on production deployment.
    const deploy = await prisma.task.findFirst({ where: { projectId: launch.id, title: "Deploy production" } });
    const analytics = await prisma.task.findFirst({ where: { projectId: launch.id, title: "Validate analytics" } });
    if (deploy && analytics) {
      await prisma.taskDependency.create({ data: { taskId: analytics.id, dependsOnId: deploy.id } });
    }

    await prisma.milestone.createMany({
      data: [
        { projectId: launch.id, title: "Plan approved", dueDate: new Date(Date.now() + 86_400_000), order: 0 },
        { projectId: launch.id, title: "Critical work complete", dueDate: new Date(Date.now() + 4 * 86_400_000), order: 1 },
        { projectId: launch.id, title: "Launch readiness verified", dueDate: new Date(Date.now() + 6 * 86_400_000), order: 2 },
      ],
    });
  }

  // ── Knowledge graph ───────────────────────────────────────────────────────
  const knowledgeSeed: Array<{ kind: "CONCEPT" | "DECISION" | "FACT" | "RISK" | "INSIGHT"; label: string; content: string; relations: Array<{ target: string; type: string; evidence: string }> }> = [
    {
      kind: "CONCEPT",
      label: "Product vision",
      content: "NEXUS is an intelligent operating layer that converts user intent into coordinated execution across agents, tools and persistent workspace state.",
      relations: [],
    },
    {
      kind: "CONCEPT",
      label: "Target audience",
      content: "Operators, founders and technical leads who coordinate complex digital workflows across documents, tasks, code and communication.",
      relations: [{ target: "Product vision", type: "RELATED_TO", evidence: "Both appear in the Product Strategy document" }],
    },
    {
      kind: "CONCEPT",
      label: "Launch strategy",
      content: "Launch publicly this week with an end-to-end demonstration of the execution pipeline: intent, context, planning, orchestration, approval, execution, validation and memory.",
      relations: [{ target: "Product vision", type: "DEPENDS_ON", evidence: "Launch narrative restates the product vision" }],
    },
    {
      kind: "CONCEPT",
      label: "Technical architecture",
      content: "Next.js App Router, strict TypeScript, PostgreSQL with Prisma and pgvector, provider-abstracted AI layer, DAG orchestrator and a central permission engine.",
      relations: [{ target: "Product vision", type: "SUPPORTS", evidence: "Architecture implements the real-state and real-control promises" }],
    },
    {
      kind: "DECISION",
      label: "Approval gating decision",
      content: "Write actions and everything above require explicit human approval; high-impact actions always require approval and cannot be auto-approved.",
      relations: [{ target: "Technical architecture", type: "PART_OF", evidence: "Documented in the architecture security section" }],
    },
    {
      kind: "RISK",
      label: "Demo credibility risk",
      content: "The primary launch risk is a demonstration that appears complete but is not: every visible number must be derived from real database state.",
      relations: [{ target: "Launch strategy", type: "BLOCKS", evidence: "Launch measure depends on credible demonstration" }],
    },
    {
      kind: "INSIGHT",
      label: "Control as differentiation",
      content: "Buyers evaluate agentic systems on trust and control; making permission levels and approvals visible is a differentiator rather than a compromise.",
      relations: [{ target: "Target audience", type: "RELATED_TO", evidence: "Derived from buyer objection analysis in Market Research" }],
    },
  ];

  if ((await prisma.knowledgeItem.count({ where: { workspaceId: WORKSPACE_ID, source: "seed" } })) === 0) {
    const created = new Map<string, string>();
    for (const item of knowledgeSeed) {
      const row = await prisma.knowledgeItem.create({
        data: {
          workspaceId: WORKSPACE_ID,
          projectId: launch.id,
          kind: item.kind,
          label: item.label,
          content: item.content,
          source: "seed",
          confidence: 0.9,
          salience: 0.8,
        },
      });
      created.set(item.label, row.id);
    }
    for (const item of knowledgeSeed) {
      for (const rel of item.relations) {
        const sourceId = created.get(item.label);
        const targetId = created.get(rel.target);
        if (!sourceId || !targetId) continue;
        await prisma.knowledgeRelation.create({
          data: { sourceId, targetId, type: rel.type, weight: 0.8, evidence: rel.evidence, derivedFrom: "seed" },
        });
      }
    }

    const { embedTexts } = await import("../src/lib/retrieval/embeddings");
    const { storeVector } = await import("../src/lib/retrieval/vector-store");
    for (const [label, id] of created) {
      const item = knowledgeSeed.find((k) => k.label === label)!;
      const [vector] = await embedTexts([`${item.label} ${item.content}`]);
      await storeVector("KnowledgeItem", id, vector);
    }
  }

  // ── Memory ────────────────────────────────────────────────────────────────
  if ((await prisma.memory.count({ where: { workspaceId: WORKSPACE_ID } })) === 0) {
    const memories: Array<{ type: "LONG_TERM" | "PROJECT" | "EXPLICIT" | "SHORT_TERM"; scope: "USER" | "PROJECT" | "SESSION"; content: string; importance: number; tags: string[] }> = [
      { type: "EXPLICIT", scope: "USER", content: "Prefers plans that are concise, sequenced by deadline, and explicit about what requires approval.", importance: 0.9, tags: ["preference", "planning"] },
      { type: "LONG_TERM", scope: "USER", content: "Works across product, engineering and go-to-market; coordinates launch work personally rather than delegating.", importance: 0.7, tags: ["working-style"] },
      { type: "PROJECT", scope: "PROJECT", content: "NEXUS Launch is targeted for this week; the launch depends on a credible end-to-end demonstration of the execution pipeline.", importance: 0.85, tags: ["launch", "deadline"] },
      { type: "PROJECT", scope: "PROJECT", content: "Analytics validation is blocked until the production deployment completes.", importance: 0.65, tags: ["dependency", "risk"] },
      { type: "LONG_TERM", scope: "USER", content: "Treats control and approval authority as the key evaluation criterion for agentic systems.", importance: 0.75, tags: ["values", "trust"] },
    ];
    const { embedTexts } = await import("../src/lib/retrieval/embeddings");
    const { storeVector } = await import("../src/lib/retrieval/vector-store");
    for (const m of memories) {
      const row = await prisma.memory.create({
        data: {
          workspaceId: WORKSPACE_ID,
          userId: user.id,
          projectId: launch.id,
          type: m.type,
          scope: m.scope,
          content: m.content,
          summary: m.content.slice(0, 120),
          source: "seed",
          importance: m.importance,
          tags: m.tags,
        },
      });
      const [vector] = await embedTexts([m.content]);
      await storeVector("Memory", row.id, vector);
    }
  }

  // ── Integrations ──────────────────────────────────────────────────────────
  const integrationSeed: Array<{ kind: "GITHUB" | "GOOGLE_DRIVE" | "GOOGLE_CALENDAR" | "GMAIL" | "SLACK" | "NOTION"; label: string }> = [
    { kind: "GITHUB", label: "github.com/nexus" },
    { kind: "GMAIL", label: "ava@nexus.ai" },
    { kind: "GOOGLE_CALENDAR", label: "ava@nexus.ai" },
    { kind: "SLACK", label: "nexus.slack.com" },
    { kind: "NOTION", label: "NEXUS workspace" },
    { kind: "GOOGLE_DRIVE", label: "NEXUS Drive" },
  ];
  for (const i of integrationSeed) {
    await prisma.integration.upsert({
      where: { workspaceId_kind: { workspaceId: WORKSPACE_ID, kind: i.kind } },
      update: { toolsAvailable: [] },
      create: { workspaceId: WORKSPACE_ID, userId: user.id, kind: i.kind, status: "NOT_CONFIGURED", accountLabel: null, scopes: [] },
    });
  }

  // ── Agents & tools ────────────────────────────────────────────────────────
  await import("../src/lib/tools");
  const { syncToolsToDb } = await import("../src/lib/tools/registry");
  const { syncAgentsToDb } = await import("../src/lib/agents/registry");
  const toolCount = await syncToolsToDb(WORKSPACE_ID);
  const agentCount = await syncAgentsToDb(WORKSPACE_ID);
  console.log(`  ✓ ${agentCount} agents, ${toolCount} tools registered`);

  // ── Example workflow ──────────────────────────────────────────────────────
  if ((await prisma.workflow.count({ where: { workspaceId: WORKSPACE_ID } })) === 0) {
    const nodes = [
      { key: "trigger", type: "TRIGGER", label: "Project created", config: { event: "project.created" }, positionX: 40, positionY: 80 },
      { key: "plan", type: "AGENT", label: "Planning Agent", config: { agentKey: "planning" }, positionX: 260, positionY: 80 },
      { key: "research", type: "AGENT", label: "Research Agent", config: { agentKey: "research" }, positionX: 480, positionY: 30 },
      { key: "confidence", type: "CONDITION", label: "Confidence > 0.6", config: { expression: "research.confidence > 0.6" }, positionX: 700, positionY: 80 },
      { key: "execute", type: "AGENT", label: "Execution Agent", config: { agentKey: "execution" }, positionX: 920, positionY: 30 },
      { key: "approval", type: "APPROVAL", label: "Approve task creation", config: { permission: "WRITE" }, positionX: 1140, positionY: 80 },
      { key: "review", type: "AGENT", label: "Review Agent", config: { agentKey: "review" }, positionX: 1360, positionY: 80 },
      { key: "output", type: "OUTPUT", label: "Plan output", config: {}, positionX: 1580, positionY: 80 },
    ];
    const edges = [
      { sourceKey: "trigger", targetKey: "plan" },
      { sourceKey: "plan", targetKey: "research" },
      { sourceKey: "research", targetKey: "confidence" },
      { sourceKey: "confidence", targetKey: "execute", label: "true" },
      { sourceKey: "execute", targetKey: "approval" },
      { sourceKey: "approval", targetKey: "review" },
      { sourceKey: "review", targetKey: "output" },
    ];

    const workflow = await prisma.workflow.create({
      data: {
        workspaceId: WORKSPACE_ID,
        userId: user.id,
        name: "Launch readiness workflow",
        description: "Plan, research, execute and review a new project launch with an approval gate.",
        status: "ACTIVE",
        version: 1,
        definition: { nodes, edges } as Prisma.InputJsonValue,
        nodes: {
          create: nodes.map((n) => ({ key: n.key, type: n.type, label: n.label, config: n.config as Prisma.InputJsonValue, positionX: n.positionX, positionY: n.positionY })),
        },
      },
      include: { nodes: true },
    });

    const keyToId = new Map(workflow.nodes.map((n) => [n.key, n.id]));
    await prisma.workflowEdge.createMany({
      data: edges.map((e) => ({
        workflowId: workflow.id,
        sourceId: keyToId.get(e.sourceKey)!,
        targetId: keyToId.get(e.targetKey)!,
        label: "label" in e ? (e.label as string) : null,
      })),
    });
  }

  // ── Historical activity (seed-generated, marked with source) ───────────────
  if ((await prisma.activity.count({ where: { workspaceId: WORKSPACE_ID } })) === 0) {
    await prisma.activity.createMany({
      data: [
        { workspaceId: WORKSPACE_ID, userId: user.id, projectId: launch.id, kind: "PROJECT", action: "project.create", summary: "Created project “NEXUS Launch”", detail: { source: "seed" }, status: "success" },
        { workspaceId: WORKSPACE_ID, userId: user.id, projectId: launch.id, kind: "DOCUMENT", action: "document.ingest", summary: "Indexed “Product Strategy”", detail: { source: "seed" }, status: "success" },
        { workspaceId: WORKSPACE_ID, userId: user.id, projectId: launch.id, kind: "DOCUMENT", action: "document.ingest", summary: "Indexed “Launch Brief”", detail: { source: "seed" }, status: "success" },
        { workspaceId: WORKSPACE_ID, userId: user.id, projectId: launch.id, kind: "DOCUMENT", action: "document.ingest", summary: "Indexed “Technical Architecture”", detail: { source: "seed" }, status: "success" },
        { workspaceId: WORKSPACE_ID, userId: user.id, projectId: launch.id, kind: "DOCUMENT", action: "document.ingest", summary: "Indexed “Market Research”", detail: { source: "seed" }, status: "success" },
        { workspaceId: WORKSPACE_ID, userId: user.id, projectId: launch.id, kind: "DOCUMENT", action: "document.ingest", summary: "Indexed “Feature Specification”", detail: { source: "seed" }, status: "success" },
        { workspaceId: WORKSPACE_ID, userId: user.id, projectId: launch.id, kind: "TASK", action: "task.update", summary: "Completed “Review architecture”", detail: { source: "seed" }, status: "success" },
        { workspaceId: WORKSPACE_ID, userId: user.id, projectId: launch.id, kind: "INTEGRATION", action: "integration.status", summary: "GitHub is not configured — github.issue.create unavailable", detail: { source: "seed" }, status: "warning" },
      ],
    });
  }

  console.log(`\n✓ NEXUS seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
