/**
 * NEXUS seed (§29, §40).
 *
 * Produces a deterministic demonstration workspace. Documents are pushed through
 * the real ingestion pipeline (extract → chunk → embed → index → knowledge
 * graph) so agent retrieval has genuine content to work with.
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';
import { ingestDocument } from '../src/lib/ingestion/pipeline';
import { writeMemory } from '../src/lib/memory/service';
import { computeProjectHealth } from '../src/server/services/project-health';
import { AGENTS } from '../src/lib/agents/registry';
import { toolRegistry } from '../src/lib/tools/registry';
import { prisma as db } from '../src/lib/db';

const prisma: PrismaClient = db;

const DEMO_EMAIL = 'demo@nexus.ai';
const DEMO_PASSWORD = 'nexus-demo-2026';

// ── Document corpus ──────────────────────────────────────────────────────────

const DOCUMENTS: { filename: string; title: string; content: string }[] = [
  {
    filename: 'product-strategy.md',
    title: 'Product Strategy',
    content: `# NEXUS Product Strategy

## Vision
NEXUS is the intelligent operating layer between a person and their digital world. It is not a chatbot, a task manager, or a bundle of disconnected AI tools. It is one system that understands intent, gathers context, reasons, plans, orchestrates specialised agents, executes what it is allowed to execute, asks for approval when something is sensitive, verifies the outcome, and remembers what mattered.

## Positioning
The category is not "AI assistant". The category is execution infrastructure for knowledge work. NEXUS competes with the friction of switching between twenty tools, not with any single tool.

## Target audience
- Operators and founders running multiple workstreams in parallel
- Product and engineering leaders who need grounded answers from their own corpus
- Analysts and researchers who require provenance for every claim
- Small teams that cannot afford a dedicated operations function

## Core value proposition
Tell NEXUS what you want to accomplish. It understands the situation, figures out what needs to happen, assembles the right agents and tools, executes what it is allowed to execute, asks for approval when necessary, verifies the result, and remembers what mattered.

## Principles
1. No fake intelligence. If NEXUS did not do the work, it does not claim the work.
2. The user is the authority. AI may recommend and prepare; the human approves.
3. Provenance is mandatory. Every retrieved item carries its source.
4. Depth over breadth. A small number of capabilities that genuinely work end to end.

## Differentiation
Most AI products optimise for the appearance of productivity. NEXUS optimises for verifiable outcomes: real retrieval, real tool calls, real state transitions, real approvals.

## Risks
The primary strategic risk is category confusion: users pattern-match NEXUS to a chatbot and under-use the execution layer. Mitigation is the command interface, which forces an outcome-oriented phrasing.
`,
  },
  {
    filename: 'launch-brief.md',
    title: 'Launch Brief',
    content: `# NEXUS Launch Brief

## Objective
Launch NEXUS publicly this week with a demo that proves the execution pipeline is real, not scripted.

## Launch narrative
"Your digital world. One intelligent system." The narrative is capability, not magic. Every demo beat must be verifiable by the viewer: if the interface says fourteen documents were analysed, fourteen documents were analysed.

## Audience
Technical founders, product leaders, and the AI-native operator community. Secondary: engineering managers evaluating internal tooling.

## Channels
- Product Hunt launch at 00:01 PT
- X announcement thread with a 90 second screen recording
- Direct email to the 1,400 person waitlist
- Founder-led outbound to 40 design partners

## Messaging pillars
1. Intent to outcome, not prompt to paragraph.
2. Real execution with real approvals.
3. Memory that actually persists and is under your control.

## Constraints
- No claims about capabilities that are not implemented
- Demo must run offline if the network is unavailable
- Every external action in the demo must stop at an approval gate

## Success criteria
- 1,000 new accounts in week one
- 300 completed command runs in the first 48 hours
- At least 40 percent of runs reach an approval gate, proving the control model is visible
`,
  },
  {
    filename: 'technical-architecture.md',
    title: 'Technical Architecture',
    content: `# NEXUS Technical Architecture

## Stack
- Next.js and React for the application shell and server routes
- TypeScript in strict mode across the entire codebase
- PostgreSQL with pgvector for relational and semantic storage
- Prisma ORM with typed models, indexes and cascades
- Tailwind CSS, Framer Motion and Lucide for the interface layer

## Pipeline
User intent enters the Command Center and is parsed by the Intent Engine into a structured object: objective, desired outcome, entities, constraints, deadline, project context, required capabilities, risk level, and permissions required.

The Context Engine then performs hybrid retrieval combining semantic similarity, BM25 keyword matching, project relevance, recency and entity overlap. Every retrieved item is persisted with its score breakdown and a rationale.

## Orchestration
The orchestrator builds a directed acyclic graph of agent nodes and executes it in topological waves. Independent nodes run in parallel. Each node is an AgentRun with persisted events, tool executions, tokens, latency and outcome.

## Agents
Seven specialised agents: Planning, Research, Knowledge, Execution, Review, Creative and Analyst. Each declares its capabilities, its permission level and the exact set of tools it may invoke. Tool calls outside that set are rejected.

## Permissions
Four levels: READ, WRITE, EXTERNAL_ACTION, HIGH_IMPACT. READ and WRITE are auto-approved by default policy. External and high-impact actions always create an Approval record and halt execution until a human decides.

## Retrieval
Documents are chunked with overlap, embedded, and stored with page, section and position provenance. Retrieval blends cosine similarity with BM25 and metadata signals. No result is returned without a source.

## Failure handling
Failures are recorded with the failing step. Safe operations are retried. Partial results are preserved. Nothing fails silently.
`,
  },
  {
    filename: 'market-research.md',
    title: 'Market Research',
    content: `# Market Research Summary

## Category landscape
Three adjacent categories exist: AI assistants, workflow automation, and agent frameworks. NEXUS sits at the intersection, but the differentiating layer is governance: approvals, permissions, provenance and memory lifecycle.

## Competitor observations
- Assistant products optimise for conversational quality and have weak state
- Workflow automation tools have strong execution but no reasoning layer
- Agent frameworks are developer-only and have no product surface

## Opportunity
The gap is a product that reasons AND executes AND is governable by a non-engineer. Buyers increasingly require audit trails for AI actions, which makes the approval model a feature rather than friction.

## Buyer objections
1. "Will it do something I did not approve?" — answered by the permission model
2. "Can I see why it did that?" — answered by context provenance and run timelines
3. "What does it remember about me?" — answered by the memory layer with lifecycle controls

## Pricing signals
Teams pay for outcomes and governance. A per-seat model with an execution credit component aligns with how value is perceived.

## Risks
Category education is expensive. Incumbents can bolt on agent features. The defence is depth of execution, verified in public.
`,
  },
  {
    filename: 'feature-specification.md',
    title: 'Feature Specification',
    content: `# NEXUS Feature Specification

## Command Center
Large intent input, recent intents, suggested actions, active runs, project shortcuts and memory context. Submitting an intent starts the execution pipeline, not a chat completion.

## Intent Engine
Structured extraction of objective, outcome, entities, constraints, deadline, project context, capabilities, risk and required permissions, with a confidence score.

## Context Engine
Hybrid retrieval across projects, documents, tasks, knowledge, memory, conversations and activity with score breakdowns and rationale per item.

## Agent system
Seven agents with declared capabilities, tool allowlists and permission levels. Runs persist status, events, tool calls, tokens, cost and duration.

## Tool registry
Modular, schema-validated tools across web, documents, knowledge, projects, tasks, files, calendar, email, GitHub, data analysis and artifact generation.

## Approvals
Sensitive actions halt execution, explain what will happen, why it is needed, which tool will be used and what data is affected. Approve, deny or modify.

## Workflows
Visual builder with trigger, agent, tool, condition, approval, delay, branch, loop and output nodes. Graphs are saved, versioned, validated and executable.

## Knowledge graph
Entities and relationships derived from ingested content only. No inferred edges are invented.

## Memory
Four layers with lifecycle management, deduplication, importance scoring and full user control.
`,
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('→ Seeding NEXUS…');

  // Reset the demo workspace (idempotent).
  const existingUser = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existingUser) {
    const memberships = await prisma.membership.findMany({ where: { userId: existingUser.id } });
    for (const membership of memberships) {
      await prisma.workspace.delete({ where: { id: membership.workspaceId } }).catch(() => undefined);
    }
    await prisma.user.delete({ where: { id: existingUser.id } }).catch(() => undefined);
  }

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: 'Avery Chen',
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: 'OWNER',
      memberships: {
        create: {
          role: 'OWNER',
          workspace: { create: { name: 'NEXUS Studio', slug: `nexus-studio-${Date.now().toString(36).slice(-4)}` } },
        },
      },
    },
    include: { memberships: { include: { workspace: true } } },
  });

  const workspace = user.memberships[0]!.workspace;

  // Friday 18:00 of the current week — matches "launch this week".
  // Past Friday (weekend, or Friday evening) rolls to the next Friday so the
  // seeded deadline is never already overdue.
  const now = new Date();
  const friday = new Date(now);
  const passed = now.getDay() === 6 || now.getDay() === 0 || (now.getDay() === 5 && now.getHours() >= 18);
  const delta = passed ? ((5 - now.getDay() + 7) % 7 || 7) : 5 - now.getDay();
  friday.setDate(friday.getDate() + delta);
  friday.setHours(18, 0, 0, 0);

  // ── Agents & tools ────────────────────────────────────────────────────────
  for (const agent of AGENTS) {
    await prisma.agent.upsert({
      where: { key: agent.key },
      create: {
        key: agent.key,
        name: agent.name,
        description: agent.description,
        category: agent.category,
        systemPrompt: agent.systemPrompt,
        capabilities: JSON.stringify(agent.capabilities),
        allowedTools: JSON.stringify(agent.allowedTools),
        permissionLevel: agent.permissionLevel,
        status: 'IDLE',
        enabled: true,
      },
      update: {
        name: agent.name,
        description: agent.description,
        capabilities: JSON.stringify(agent.capabilities),
        allowedTools: JSON.stringify(agent.allowedTools),
      },
    });
  }

  for (const tool of toolRegistry.list()) {
    await prisma.tool.upsert({
      where: { key: tool.key },
      create: {
        key: tool.key,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        schema: JSON.stringify(tool.parameters),
        permissionLevel: tool.permission,
        requiresAuth: tool.requiresIntegration ?? null,
        timeoutMs: tool.timeoutMs,
        maxRetries: tool.maxRetries,
      },
      update: { description: tool.description, category: tool.category },
    });
  }

  // ── Project ───────────────────────────────────────────────────────────────
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      ownerId: user.id,
      name: 'NEXUS Launch',
      slug: `nexus-launch-${Date.now().toString(36).slice(-4)}`,
      description: 'Public launch of NEXUS: positioning, assets, release and measurement.',
      objective: 'Launch NEXUS publicly this week with a verifiable demonstration.',
      summary:
        'NEXUS is positioned as the intelligent operating layer for a person’s digital world. The launch must prove the execution pipeline is real: intent, context, planning, orchestration, tools, approvals and memory.',
      status: 'ACTIVE',
      priority: 'CRITICAL',
      deadline: friday,
      tags: JSON.stringify(['launch', 'positioning', 'go-to-market']),
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
  });

  // ── Tasks (§29) ───────────────────────────────────────────────────────────
  const taskSpecs: { title: string; description: string; status: string; priority: string; dueInDays: number; assignee?: string }[] = [
    { title: 'Finalize landing page', description: 'Lock hero copy, visuals, CTA and above-the-fold proof.', status: 'IN_PROGRESS', priority: 'HIGH', dueInDays: 1, assignee: 'Avery Chen' },
    { title: 'Prepare launch video', description: 'Ninety second walkthrough of the command-to-approval pipeline.', status: 'TODO', priority: 'MEDIUM', dueInDays: 3 },
    { title: 'Review architecture', description: 'Confirm production readiness, scaling limits and failure paths.', status: 'TODO', priority: 'HIGH', dueInDays: 2, assignee: 'Priya Raman' },
    { title: 'Prepare announcement', description: 'Blog post, changelog and waitlist email.', status: 'TODO', priority: 'HIGH', dueInDays: 4, assignee: 'Avery Chen' },
    { title: 'Deploy production', description: 'Run the release checklist and ship the production build.', status: 'BLOCKED', priority: 'URGENT', dueInDays: 5 },
    { title: 'Validate analytics', description: 'Confirm instrumentation, funnels and alerting fire correctly.', status: 'TODO', priority: 'MEDIUM', dueInDays: 5 },
  ];

  const tasks = [];
  for (const spec of taskSpecs) {
    const due = new Date();
    due.setDate(due.getDate() + spec.dueInDays);
    tasks.push(
      await prisma.task.create({
        data: {
          workspaceId: workspace.id,
          projectId: project.id,
          createdById: user.id,
          title: spec.title,
          description: spec.description,
          status: spec.status,
          priority: spec.priority,
          deadline: due,
          assignee: spec.assignee ?? null,
        },
      }),
    );
  }

  // Deploy production is blocked by the architecture review.
  const review = tasks.find((t) => t.title === 'Review architecture')!;
  const deploy = tasks.find((t) => t.title === 'Deploy production')!;
  await prisma.taskDependency.create({
    data: { taskId: deploy.id, dependsOnId: review.id, type: 'BLOCKS' },
  });

  await prisma.milestone.createMany({
    data: [
      { projectId: project.id, title: 'Scope locked', description: 'Positioning and launch narrative signed off.', dueDate: new Date(Date.now() + 86_400_000), order: 0 },
      { projectId: project.id, title: 'Assets ready', description: 'Landing page, video and announcement complete.', dueDate: new Date(Date.now() + 3 * 86_400_000), order: 1 },
      { projectId: project.id, title: 'Go-live', description: 'Production deployed and analytics verified.', dueDate: friday, order: 2 },
    ],
  });

  // ── Documents through the real pipeline ───────────────────────────────────
  for (const doc of DOCUMENTS) {
    await ingestDocument({
      workspaceId: workspace.id,
      userId: user.id,
      projectId: project.id,
      filename: doc.filename,
      mimeType: 'text/markdown',
      buffer: Buffer.from(doc.content, 'utf8'),
    });
    console.log(`   indexed ${doc.title}`);
  }

  // ── Knowledge (§29) ───────────────────────────────────────────────────────
  const knowledgeSeeds = [
    { type: 'CONCEPT', title: 'Product vision', content: 'NEXUS is the intelligent operating layer between a person and their digital world — one system that understands intent and executes with governance.' },
    { type: 'CONCEPT', title: 'Target audience', content: 'Operators, founders, product and engineering leaders, analysts, and small teams without a dedicated operations function.' },
    { type: 'DECISION', title: 'Launch strategy', content: 'Launch this week on Product Hunt and X, with a waitlist email and founder-led outbound. No claims about unimplemented capability.' },
    { type: 'CONCEPT', title: 'Technical architecture', content: 'Next.js and React, TypeScript strict, PostgreSQL with pgvector, Prisma, and a seven-agent orchestrator behind a four-level permission model.' },
  ];

  for (const item of knowledgeSeeds) {
    await prisma.knowledgeItem.create({
      data: {
        workspaceId: workspace.id,
        projectId: project.id,
        type: item.type,
        title: item.title,
        content: item.content,
        summary: item.content.slice(0, 240),
        source: 'USER',
        confidence: 0.95,
        embedding: JSON.stringify(new Array(384).fill(0)),
      },
    });
  }

  // Recompute embeddings for seeded knowledge items through the real embedder.
  const { embedSyncSerialized } = await import('../src/lib/ai');
  for (const item of await prisma.knowledgeItem.findMany({ where: { workspaceId: workspace.id } })) {
    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: { embedding: embedSyncSerialized(`${item.title} ${item.content ?? ''}`) },
    });
  }

  // ── Memory (§29) ──────────────────────────────────────────────────────────
  const memories = [
    { type: 'LONG_TERM' as const, content: 'Prefers concise, direct communication with no hype language in generated copy.', importance: 78 },
    { type: 'PROJECT' as const, content: 'NEXUS Launch is the active priority this week; deadline is Friday 18:00.', importance: 85, projectId: project.id },
    { type: 'EXPLICIT' as const, content: 'Never send external communications without explicit approval.', importance: 95 },
    { type: 'PROJECT' as const, content: 'Deploy production is blocked by the architecture review — resolve the review first.', importance: 72, projectId: project.id },
    { type: 'LONG_TERM' as const, content: 'Launch messaging emphasises verifiable execution over conversational polish.', importance: 68 },
  ];
  for (const memory of memories) {
    await writeMemory({
      workspaceId: workspace.id,
      userId: user.id,
      content: memory.content,
      type: memory.type,
      importance: memory.importance,
      projectId: memory.projectId ?? null,
      source: 'USER',
      confidence: 1,
      pinned: memory.importance >= 90,
    });
  }

  // ── Integrations ──────────────────────────────────────────────────────────
  await prisma.integration.createMany({
    data: [
      { userId: user.id, key: 'github', name: 'GitHub', description: 'Read repositories and open issues.', status: 'DISCONNECTED', scopes: JSON.stringify(['repo', 'issues:write']), availableTools: JSON.stringify(['github.repository', 'github.issue.create']) },
      { userId: user.id, key: 'google_drive', name: 'Google Drive', description: 'Index documents from Drive.', status: 'DISCONNECTED', scopes: JSON.stringify(['drive.readonly']), availableTools: JSON.stringify(['documents.list']) },
      { userId: user.id, key: 'google_calendar', name: 'Google Calendar', description: 'Sync events created by NEXUS.', status: 'DISCONNECTED', scopes: JSON.stringify(['calendar.events']), availableTools: JSON.stringify(['calendar.create']) },
      { userId: user.id, key: 'gmail', name: 'Gmail', description: 'Send approved drafts.', status: 'DISCONNECTED', scopes: JSON.stringify(['gmail.send']), availableTools: JSON.stringify(['email.draft']) },
      { userId: user.id, key: 'slack', name: 'Slack', description: 'Post updates to channels.', status: 'DISCONNECTED', scopes: JSON.stringify(['chat:write']), availableTools: JSON.stringify([]) },
      { userId: user.id, key: 'notion', name: 'Notion', description: 'Sync pages into knowledge.', status: 'DISCONNECTED', scopes: JSON.stringify(['pages:read']), availableTools: JSON.stringify([]) },
    ],
  });

  // ── Example workflow (§18) ────────────────────────────────────────────────
  await prisma.workflow.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      projectId: project.id,
      name: 'Launch readiness check',
      description: 'Runs the analyst and review agents over the launch project, then requests approval before drafting the announcement.',
      version: 1,
      status: 'ACTIVE',
      trigger: 'MANUAL',
      graph: JSON.stringify({
        nodes: [
          { id: 't1', type: 'TRIGGER', label: 'Manual trigger', data: {} },
          { id: 'a1', type: 'AGENT', label: 'Analyst Agent', data: { agentKey: 'analyst', instruction: 'Analyse launch readiness for NEXUS Launch' } },
          { id: 'a2', type: 'AGENT', label: 'Review Agent', data: { agentKey: 'review', instruction: 'Review launch blockers and rank them' } },
          { id: 'c1', type: 'CONDITION', label: 'Blockers found?', data: { expression: 'a2.result.blocked > 0' } },
          { id: 'ap1', type: 'APPROVAL', label: 'Approve announcement', data: { title: 'Draft the launch announcement', description: 'Creates an email draft for review.', permission: 'EXTERNAL_ACTION' } },
          { id: 'tl1', type: 'TOOL', label: 'Draft announcement', data: { toolKey: 'email.draft', args: { subject: 'NEXUS is live', body: 'NEXUS is live. Here is what changed.' } } },
          { id: 'o1', type: 'OUTPUT', label: 'Capture result', data: {} },
        ],
        edges: [
          { id: 'e1', from: 't1', to: 'a1', fromHandle: 'out' },
          { id: 'e2', from: 'a1', to: 'a2', fromHandle: 'out' },
          { id: 'e3', from: 'a2', to: 'c1', fromHandle: 'out' },
          { id: 'e4', from: 'c1', to: 'ap1', fromHandle: 'true' },
          { id: 'e5', from: 'c1', to: 'o1', fromHandle: 'false' },
          { id: 'e6', from: 'ap1', to: 'tl1', fromHandle: 'out' },
          { id: 'e7', from: 'tl1', to: 'o1', fromHandle: 'out' },
        ],
      }),
    },
  });

  // ── Activity & notifications ──────────────────────────────────────────────
  await prisma.activity.createMany({
    data: [
      { workspaceId: workspace.id, userId: user.id, projectId: project.id, type: 'PROJECT', action: 'Project created', summary: 'NEXUS Launch', severity: 'SUCCESS', entityType: 'PROJECT', entityId: project.id },
      { workspaceId: workspace.id, userId: user.id, projectId: project.id, type: 'TASK', action: 'Task created', summary: 'Finalize landing page', severity: 'INFO' },
      { workspaceId: workspace.id, userId: user.id, projectId: project.id, type: 'TASK', action: 'Task blocked', summary: 'Deploy production is blocked by Review architecture', severity: 'WARNING' },
      { workspaceId: workspace.id, userId: user.id, projectId: project.id, type: 'MEMORY', action: 'Memory saved', summary: 'Never send external communications without explicit approval.', severity: 'INFO' },
    ],
  });

  await prisma.notification.createMany({
    data: [
      { userId: user.id, workspaceId: workspace.id, projectId: project.id, type: 'DEADLINE', title: 'Launch deadline this week', body: 'NEXUS Launch is due Friday 18:00.', severity: 'WARNING', actionUrl: `/projects/${project.id}` },
      { userId: user.id, workspaceId: workspace.id, projectId: project.id, type: 'PROJECT_RISK', title: 'Blocked task in NEXUS Launch', body: 'Deploy production is blocked by Review architecture.', severity: 'WARNING', actionUrl: '/tasks' },
    ],
  });

  // ── Settings ──────────────────────────────────────────────────────────────
  await prisma.setting.createMany({
    data: [
      { userId: user.id, namespace: 'permissions', key: 'policy', value: JSON.stringify({ READ: true, WRITE: true, EXTERNAL_ACTION: false, HIGH_IMPACT: false, requireApprovalForAll: false }) },
      { userId: user.id, namespace: 'ai', key: 'config', value: JSON.stringify({ provider: 'mock', model: 'nexus-deterministic-1', temperature: 0.2, maxTokens: 2048, embeddingModel: 'nexus-local-384' }) },
      { userId: user.id, namespace: 'appearance', key: 'theme', value: JSON.stringify({ theme: 'dark', motion: 'full', density: 'comfortable' }) },
      { userId: user.id, namespace: 'notifications', key: 'preferences', value: JSON.stringify({ approvals: true, agentCompleted: true, agentFailed: true, deadlines: true, projectRisk: true }) },
    ],
  });

  const health = await computeProjectHealth(project.id, true);

  console.log('');
  console.log('  NEXUS seeded');
  console.log('  ─────────────────────────────────────────');
  console.log(`  email      ${DEMO_EMAIL}`);
  console.log(`  password   ${DEMO_PASSWORD}`);
  console.log(`  project    ${project.name} (health: ${health.health}, score ${health.healthScore})`);
  console.log(`  documents  ${DOCUMENTS.length} indexed`);
  console.log(`  tasks      ${tasks.length}`);
  console.log(`  agents     ${AGENTS.length}`);
  console.log(`  tools      ${toolRegistry.keys().length}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
