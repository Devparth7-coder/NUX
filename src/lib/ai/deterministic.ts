/**
 * Deterministic local inference engine.
 *
 * This is NOT a language model. It is a rule-based, fully deterministic
 * stand-in used when no external model provider is configured (DEMO MODE).
 * Every generator below operates on *real* data handed to it through
 * `metadata` — retrieved passages, task rows, project rows — so the outputs
 * are grounded in the workspace rather than invented.
 *
 * If an OpenAI key is configured, the orchestrator transparently uses
 * OpenAIProvider instead and these generators are never called.
 */
import type { AIMessage } from "./types";

type Meta = Record<string, unknown>;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function deterministicGenerate(purpose: string, messages: AIMessage[], metadata: Meta = {}): unknown {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  switch (purpose) {
    case "intent.parse":
      return parseIntent(typeof metadata.rawInput === "string" ? metadata.rawInput : lastUser, metadata);
    case "plan.create":
      return createPlan(metadata);
    case "research.synthesize":
      return synthesizeResearch(metadata);
    case "knowledge.synthesize":
      return synthesizeKnowledge(metadata);
    case "execution.plan":
      return planExecution(metadata);
    case "review.validate":
      return validateResult(metadata);
    case "artifact.write":
      return writeArtifact(metadata);
    case "memory.extract":
      return extractMemories(metadata);
    case "chat.reply":
      return chatReply(metadata);
    case "analyst.report":
      return analystReport(metadata);
    default:
      return { message: lastUser, note: "deterministic engine: no specialised generator for purpose " + purpose };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTENT PARSING — real rule-based NLP over the user's literal input
// ─────────────────────────────────────────────────────────────────────────────

const CAPABILITY_RULES: Array<{ match: RegExp; capability: string }> = [
  { match: /\b(research|competitor|market|investigate|explore|find out)\b/i, capability: "research" },
  { match: /\b(plan|launch|roadmap|schedule|milestone|prepare|organi[sz]e)\b/i, capability: "planning" },
  { match: /\b(analy[sz]e|analysis|metric|trend|number|data|report)\b/i, capability: "analysis" },
  { match: /\b(writ\w+|draft\w*|announce\w*|presentation|deck|copy|post\w*|blog|email\w*|newsletter)\b/i, capability: "content" },
  { match: /\b(review|check|audit|validate|verify|qa)\b/i, capability: "review" },
  { match: /\b(document|read|summari[sz]e|extract|knowledge)\b/i, capability: "document_analysis" },
  { match: /\b(task|todo|assign|track)\b/i, capability: "task_management" },
  { match: /\b(execute|run|deploy|create|update|send|publish)\b/i, capability: "execution" },
];

const RISK_RULES: Array<{ match: RegExp; level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; why: string }> = [
  { match: /\b(delete|destroy|drop|remove production|wipe)\b/i, level: "CRITICAL", why: "destructive operation requested" },
  { match: /\b(send|email|publish|post|tweet|deploy|push|announce)\b/i, level: "HIGH", why: "externally visible or hard-to-reverse action" },
  { match: /\b(launch|payment|billing|contract|legal)\b/i, level: "MEDIUM", why: "business-critical objective" },
  { match: /\b(urgent|asap|immediately|today|tonight)\b/i, level: "MEDIUM", why: "compressed timeline" },
];

const VERB_OBJECTIVE: Array<{ match: RegExp; objective: string }> = [
  { match: /\b(launch|ship|release|go live)\b/i, objective: "launch" },
  { match: /\b(analy[sz]e|analysis)\b/i, objective: "analyze" },
  { match: /\b(research|investigate|explore)\b/i, objective: "research" },
  { match: /\b(prepare|draft|write|create)\b/i, objective: "create" },
  { match: /\b(review|audit|check|validate)\b/i, objective: "review" },
  { match: /\b(plan|schedule|organi[sz]e)\b/i, objective: "plan" },
  { match: /\b(fix|resolve|debug)\b/i, objective: "resolve" },
  { match: /\b(summar|brief)/i, objective: "summarize" },
];

function parseIntent(raw: string, metadata: Meta) {
  const text = raw.trim();
  const lower = text.toLowerCase();

  const objective = VERB_OBJECTIVE.find((r) => r.match.test(lower))?.objective ?? "accomplish";
  const capabilities = uniq(CAPABILITY_RULES.filter((r) => r.match.test(lower)).map((r) => r.capability));
  if (!capabilities.includes("planning") && ["launch", "plan", "create", "resolve"].includes(objective)) {
    capabilities.unshift("planning");
  }
  if (!capabilities.includes("task_management") && ["launch", "plan", "resolve"].includes(objective)) {
    capabilities.push("task_management");
  }

  const deadline = resolveDeadline(text);
  const risk = RISK_RULES.filter((r) => r.match.test(lower));
  const riskLevel = risk.length ? (risk.map((r) => r.level).includes("CRITICAL") ? "CRITICAL" : risk.map((r) => r.level).includes("HIGH") ? "HIGH" : "MEDIUM") : "LOW";

  const candidates = (metadata.projectCandidates as Array<{ id: string; name: string }> | undefined) ?? [];
  const project = matchProject(text, candidates);
  const entities = extractEntities(text, project, metadata);

  const permissions: string[] = ["READ"];
  if (/create|update|draft|prepare|add|assign/i.test(lower)) permissions.push("WRITE");
  if (/send|email|publish|post|deploy|announce|slack/i.test(lower)) permissions.push("EXTERNAL_ACTION");
  if (riskLevel === "CRITICAL") permissions.push("HIGH_IMPACT");

  const constraints: string[] = [];
  if (deadline.text) constraints.push(`Must be complete ${deadline.text}`);
  if (/\bwithout (increasing|adding)\b/i.test(lower)) constraints.push("No additional budget or headcount");
  const budget = text.match(/under\s*\$?([\d,]+)/i);
  if (budget) constraints.push(`Budget ceiling $${budget[1]}`);

  const desiredOutcome =
    objective === "launch"
      ? `A complete, reviewed launch plan for ${project?.name ?? "the project"} with owned tasks and approvals resolved`
      : objective === "analyze"
        ? "A grounded analysis with evidence from workspace documents"
        : objective === "research"
          ? "A cited research summary with sources and confidence"
          : objective === "review"
            ? "A validated result with detected issues and recommendations"
            : `Achieve: ${text.replace(/[.!?]+$/, "")}`;

  let confidence = 0.55;
  if (project) confidence += 0.2;
  if (deadline.date) confidence += 0.1;
  if (capabilities.length >= 2) confidence += 0.08;
  if (text.split(/\s+/).length > 6) confidence += 0.05;

  return {
    objective,
    desiredOutcome,
    entities,
    constraints,
    deadlineText: deadline.text,
    deadline: deadline.date,
    projectContext: project ? { id: project.id, name: project.name } : null,
    requiredCapabilities: capabilities,
    riskLevel,
    permissionsRequired: uniq(permissions),
    confidence: Math.min(0.97, Number(confidence.toFixed(2))),
    reasoningSummary: `Classified intent as "${objective}" from the request verb; detected ${capabilities.length} required capabilities, ${deadline.text ? `a deadline of "${deadline.text}"` : "no explicit deadline"}, and ${riskLevel.toLowerCase()} risk${risk.length ? ` (${risk[0].why})` : ""}.`,
  };
}

function resolveDeadline(text: string): { text: string | null; date: string | null } {
  const lower = text.toLowerCase();
  const now = new Date();
  const iso = (d: Date) => d.toISOString();

  if (/this week|by the end of the week|eow|end of week/i.test(lower)) {
    const d = endOfWeek(now);
    return { text: "this week", date: iso(d) };
  }
  if (/next week/i.test(lower)) {
    const d = endOfWeek(addDays(now, 7));
    return { text: "next week", date: iso(d) };
  }
  if (/today|tonight|by eod|end of day/i.test(lower)) return { text: "today", date: iso(endOfDay(now)) };
  if (/tomorrow/i.test(lower)) return { text: "tomorrow", date: iso(endOfDay(addDays(now, 1))) };
  if (/this month|by month end/i.test(lower)) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0, 18, 0, 0);
    return { text: "this month", date: iso(d) };
  }
  if (/next (\d+) days/i.test(lower)) {
    const n = Number(lower.match(/next (\d+) days/i)![1]);
    return { text: `next ${n} days`, date: iso(endOfDay(addDays(now, n))) };
  }
  const isoDate = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDate) {
    const d = new Date(`${isoDate[1]}-${isoDate[2]}-${isoDate[3]}T18:00:00`);
    return { text: isoDate[0], date: iso(d) };
  }
  const weekday = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`, "i").test(lower));
  if (weekday >= 0) {
    const delta = (weekday - now.getDay() + 7) % 7 || 7;
    return { text: WEEKDAYS[weekday], date: iso(endOfDay(addDays(now, delta))) };
  }
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const monthIdx = months.findIndex((m) => new RegExp(`\\b${m}\\b`, "i").test(lower));
  if (monthIdx >= 0) {
    const day = Number((lower.match(new RegExp(`${months[monthIdx]}\\s+(\\d{1,2})`, "i")) ?? [])[1] ?? 1);
    const d = new Date(now.getFullYear(), monthIdx, day, 18, 0, 0);
    if (d < now) d.setFullYear(d.getFullYear() + 1);
    return { text: `${months[monthIdx]} ${day}`, date: iso(d) };
  }
  return { text: null, date: null };
}

function matchProject(text: string, candidates: Array<{ id: string; name: string }>) {
  const lower = text.toLowerCase();
  let best: { id: string; name: string; score: number } | null = null;
  for (const c of candidates) {
    const name = c.name.toLowerCase();
    let score = 0;
    if (lower.includes(name)) score = name.split(/\s+/).length * 10;
    else {
      const words = name.split(/\s+/).filter((w) => w.length > 3);
      const hits = words.filter((w) => lower.includes(w)).length;
      score = hits * 5;
    }
    if (score > 0 && (!best || score > best.score)) best = { ...c, score };
  }
  return best;
}

function extractEntities(text: string, project: { id: string; name: string } | null, metadata: Meta) {
  const entities: Array<{ type: string; name: string; id?: string }> = [];
  if (project) entities.push({ type: "PROJECT", name: project.name, id: project.id });
  const docTitles = (metadata.documentTitles as string[] | undefined) ?? [];
  for (const title of docTitles) {
    if (text.toLowerCase().includes(title.toLowerCase().slice(0, 24))) {
      entities.push({ type: "DOCUMENT", name: title });
    }
  }
  for (const m of text.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g) ?? []) {
    if (m.length > 3 && !/^(I|The|This|What|How|When|Why|Prepare|Review|Research|Analyze|Find|Create|Make|Help)$/.test(m)) {
      if (!entities.some((e) => e.name.toLowerCase() === m.toLowerCase())) {
        entities.push({ type: "CONCEPT", name: m });
      }
    }
  }
  return entities.slice(0, 12);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANNING
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_FOR_CAPABILITY: Record<string, string> = {
  planning: "planning",
  research: "research",
  document_analysis: "knowledge",
  knowledge: "knowledge",
  analysis: "analyst",
  content: "creative",
  review: "review",
  execution: "execution",
  task_management: "execution",
};

function createPlan(metadata: Meta) {
  const intent = (metadata.intent as { objective?: string; requiredCapabilities?: string[]; deadlineText?: string | null } | undefined) ?? {};
  const existingTasks = (metadata.existingTasks as Array<{ id: string; title: string; status: string; dueDate?: string | null }> | undefined) ?? [];
  const capabilities = intent.requiredCapabilities ?? ["planning"];
  const openTasks = existingTasks.filter((t) => t.status !== "DONE");

  const steps: Array<{ id: string; title: string; agent: string; capability: string; dependsOn: string[]; rationale: string }> = [];
  steps.push({
    id: "step-plan",
    title: "Decompose the objective into an ordered work plan",
    agent: "planning",
    capability: "planning",
    dependsOn: [],
    rationale: "Every objective is decomposed before any agent acts on it.",
  });

  // Grounding is mandatory for any objective that will produce a commitment:
  // research gathers evidence, knowledge structures it. Both run in parallel
  // after planning and before execution.
  const needsGrounding =
    capabilities.includes("research") ||
    capabilities.includes("document_analysis") ||
    capabilities.includes("knowledge") ||
    ["launch", "analyze", "research", "create", "summarize", "review"].includes(intent.objective ?? "");

  if (needsGrounding) {
    steps.push({
      id: "step-research",
      title: "Gather and cross-check evidence from workspace sources",
      agent: "research",
      capability: "research",
      dependsOn: ["step-plan"],
      rationale: "Evidence is collected from workspace sources before any commitment is made.",
    });
    steps.push({
      id: "step-knowledge",
      title: "Retrieve and structure project knowledge",
      agent: "knowledge",
      capability: "document_analysis",
      dependsOn: ["step-plan"],
      rationale: "Grounding in project knowledge prevents unsupported recommendations.",
    });
  }
  if (capabilities.includes("analysis")) {
    steps.push({
      id: "step-analyst",
      title: "Quantify progress, deadlines and risk exposure",
      agent: "analyst",
      capability: "analysis",
      dependsOn: steps.filter((s) => s.id !== "step-plan").map((s) => s.id).slice(-1),
      rationale: "Numeric check on scope versus the requested deadline.",
    });
  }
  steps.push({
    id: "step-execution",
    title: "Execute permitted workspace actions and prepare approvals",
    agent: "execution",
    capability: "execution",
    dependsOn: steps.filter((s) => s.id !== "step-execution").map((s) => s.id),
    rationale: "Execution only starts once upstream grounding steps have completed.",
  });
  if (capabilities.includes("content")) {
    steps.push({
      id: "step-creative",
      title: "Draft launch narrative and announcement copy",
      agent: "creative",
      capability: "content",
      dependsOn: ["step-execution"],
      rationale: "Content is drafted from the verified plan, not before it.",
    });
  }
  steps.push({
    id: "step-review",
    title: "Validate outputs, detect gaps and record recommendations",
    agent: "review",
    capability: "review",
    dependsOn: [capabilities.includes("content") ? "step-creative" : "step-execution"],
    rationale: "No result is presented to the user without validation.",
  });

  const risks: Array<{ title: string; severity: string; mitigation: string }> = [];
  if (intent.deadlineText) {
    risks.push({
      title: `Deadline pressure: ${intent.deadlineText}`,
      severity: "MEDIUM",
      mitigation: "Sequence approval-dependent work first; defer non-blocking polish.",
    });
  }
  if (openTasks.length > 4) {
    risks.push({
      title: `${openTasks.length} open tasks already in flight`,
      severity: "MEDIUM",
      mitigation: "Re-scope or reassign before adding new commitments.",
    });
  }
  const overdue = existingTasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "DONE");
  if (overdue.length) {
    risks.push({
      title: `${overdue.length} overdue task(s) detected`,
      severity: "HIGH",
      mitigation: "Resolve or re-date overdue work before the new deadline is accepted.",
    });
  }

  return {
    steps,
    milestones: [
      { title: "Plan approved", dueOffsetDays: 0 },
      { title: "Critical work complete", dueOffsetDays: 3 },
      { title: "Launch readiness verified", dueOffsetDays: 6 },
    ],
    risks,
    notes: `Plan built from ${capabilities.length} detected capabilities against ${existingTasks.length} existing tasks.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH — extractive over real retrieved passages
// ─────────────────────────────────────────────────────────────────────────────

function synthesizeResearch(metadata: Meta) {
  const query = String(metadata.query ?? "");
  const passages = (metadata.passages as Array<{ id: string; title: string; content: string; score?: number }> | undefined) ?? [];

  const sentences = passages.flatMap((p) =>
    p.content
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 40 && s.length < 400)
      .map((s) => ({ passage: p, sentence: s, score: lexicalScore(query, s) })),
  );
  sentences.sort((a, b) => b.score - a.score);

  const findings = sentences.slice(0, 6).map((s, i) => ({
    id: `finding-${i + 1}`,
    claim: s.sentence,
    confidence: Number(Math.min(0.95, 0.4 + s.score * 0.6).toFixed(2)),
    evidence: [
      {
        sourceId: s.passage.id,
        sourceTitle: s.passage.title,
        quote: s.sentence.slice(0, 280),
      },
    ],
  }));

  const sources = uniq(passages.map((p) => p.title)).slice(0, 10);
  const confidence = findings.length
    ? Number((findings.reduce((a, f) => a + f.confidence, 0) / findings.length).toFixed(2))
    : 0;

  return {
    query,
    summary: findings.length
      ? `${findings.length} findings extracted from ${sources.length} workspace source(s). ` +
        findings.slice(0, 2).map((f) => f.claim).join(" ")
      : `No workspace evidence matched "${query}". Web sources are unavailable in DEMO MODE.`,
    findings,
    sources,
    gaps: findings.length < 3 ? ["Evidence base is thin — consider uploading source documents."] : [],
    confidence,
  };
}

function synthesizeKnowledge(metadata: Meta) {
  const items = (metadata.items as Array<{ id: string; label: string; kind: string; content: string }> | undefined) ?? [];
  const relations: Array<{ source: string; target: string; type: string; weight: number; evidence: string }> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const shared = sharedTerms(a.content, b.content);
      if (shared.length >= 3) {
        relations.push({
          source: a.id,
          target: b.id,
          type: a.kind === "DECISION" || b.kind === "DECISION" ? "SUPPORTS" : "RELATED_TO",
          weight: Number(Math.min(1, shared.length / 8).toFixed(2)),
          evidence: `Shared terms: ${shared.slice(0, 5).join(", ")}`,
        });
      }
    }
  }
  return {
    insights: items.slice(0, 5).map((i) => ({ itemId: i.id, label: i.label, insight: firstSentence(i.content) })),
    relations: relations.slice(0, 12),
    entityCount: items.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION / REVIEW / ARTIFACTS / MEMORY / CHAT
// ─────────────────────────────────────────────────────────────────────────────

function planExecution(metadata: Meta) {
  const intent = (metadata.intent ?? {}) as { objective?: string; deadline?: string | null };
  const draftTasks = (metadata.draftTasks as Array<{ title: string; priority?: string }> | undefined) ?? [];
  return {
    taskCount: draftTasks.length,
    dueBy: intent.deadline ?? null,
    rationale: `Materialising ${draftTasks.length} task(s) derived from the approved plan.`,
  };
}

function validateResult(metadata: Meta) {
  const tasks = (metadata.tasks as Array<{ title: string; dueDate?: string | null; status?: string; priority?: string }> | undefined) ?? [];
  const deadline = (metadata.deadline as string | null | undefined) ?? null;
  const checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }> = [];

  checks.push({
    name: "Plan produced executable tasks",
    status: tasks.length > 0 ? "pass" : "fail",
    detail: `${tasks.length} task(s) generated.`,
  });

  if (deadline) {
    const after = tasks.filter((t) => t.dueDate && new Date(t.dueDate) > new Date(deadline));
    checks.push({
      name: "All tasks fit inside the deadline window",
      status: after.length === 0 ? "pass" : "fail",
      detail: after.length ? `${after.length} task(s) scheduled after the deadline.` : "Every task lands on or before the deadline.",
    });
  }
  const noDue = tasks.filter((t) => !t.dueDate);
  checks.push({
    name: "Every task has a due date",
    status: noDue.length === 0 ? "pass" : "warn",
    detail: noDue.length ? `${noDue.length} task(s) lack a due date.` : "All tasks are dated.",
  });
  const urgent = tasks.filter((t) => t.priority === "URGENT");
  checks.push({
    name: "Priority load is realistic",
    status: urgent.length <= Math.max(2, Math.ceil(tasks.length / 3)) ? "pass" : "warn",
    detail: `${urgent.length} urgent of ${tasks.length} total.`,
  });

  const findings = (metadata.findings as Array<{ confidence: number }> | undefined) ?? [];
  if (findings.length) {
    const avg = findings.reduce((a, f) => a + f.confidence, 0) / findings.length;
    checks.push({
      name: "Evidence confidence above 0.6",
      status: avg >= 0.6 ? "pass" : "warn",
      detail: `Mean evidence confidence ${avg.toFixed(2)} across ${findings.length} findings.`,
    });
  }

  const failed = checks.filter((c) => c.status === "fail").length;
  return {
    passed: failed === 0,
    checks,
    recommendations: checks
      .filter((c) => c.status !== "pass")
      .map((c) => ({ title: c.name, detail: c.detail, severity: c.status === "fail" ? "high" : "medium" })),
  };
}

function writeArtifact(metadata: Meta) {
  const kind = String(metadata.kind ?? "REPORT");
  const title = String(metadata.title ?? "NEXUS output");
  const sections = (metadata.sections as Array<{ heading: string; body: string }> | undefined) ?? [];
  const content = [`# ${title}`, "", ...sections.flatMap((s) => [`## ${s.heading}`, "", s.body, ""])].join("\n");
  return {
    title,
    type: kind,
    summary: firstSentence(sections.map((s) => s.body).join(" ")) || title,
    content,
    format: "markdown",
  };
}

function extractMemories(metadata: Meta) {
  const intent = (metadata.intent ?? {}) as { objective?: string; deadlineText?: string | null; projectContext?: { name: string } | null };
  const facts = (metadata.facts as string[] | undefined) ?? [];
  const memories: Array<{ content: string; type: string; importance: number; scope: string; tags: string[] }> = [];
  if (intent.objective && intent.deadlineText) {
    memories.push({
      content: `User is driving a "${intent.objective}" objective with a deadline of ${intent.deadlineText}${intent.projectContext ? ` for ${intent.projectContext.name}` : ""}.`,
      type: "PROJECT",
      importance: 0.8,
      scope: "PROJECT",
      tags: ["objective", "deadline"],
    });
  }
  for (const f of facts.slice(0, 4)) {
    memories.push({ content: f, type: "LONG_TERM", importance: 0.6, scope: "USER", tags: ["derived"] });
  }
  return { memories };
}

function chatReply(metadata: Meta) {
  const summary = String(metadata.summary ?? "");
  const counts = (metadata.counts ?? {}) as Record<string, number>;
  const parts: string[] = [];
  if (summary) parts.push(summary);
  const bits = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`);
  if (bits.length) parts.push(`Produced ${bits.join(", ")}.`);
  return { message: parts.join(" ") || "Execution complete." };
}

function analystReport(metadata: Meta) {
  const tasks = (metadata.tasks as Array<{ status: string; dueDate?: string | null; priority?: string }> | undefined) ?? [];
  const total = tasks.length || 1;
  const done = tasks.filter((t) => t.status === "DONE").length;
  const overdue = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "DONE").length;
  return {
    metrics: [
      { label: "Tasks", value: tasks.length },
      { label: "Completion", value: `${Math.round((done / total) * 100)}%` },
      { label: "Overdue", value: overdue },
    ],
    insights: [
      done / total >= 0.7 ? "Delivery is on track." : "Less than 70% of scoped work is complete.",
      overdue > 0 ? `${overdue} task(s) are past their due date.` : "No overdue work detected.",
    ],
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

const STOP = new Set("the a an and or of to in for on with at by from is are was were be been this that it its as can will would should could have has had not no but if then than so we you your our their they he she i me my".split(" "));

function terms(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

function lexicalScore(query: string, text: string) {
  const q = new Set(terms(query));
  if (!q.size) return 0.2;
  const t = terms(text);
  const hits = t.filter((w) => q.has(w)).length;
  return Math.min(1, hits / Math.min(q.size, 6));
}

function sharedTerms(a: string, b: string) {
  const setA = new Set(terms(a));
  return terms(b).filter((w) => setA.has(w));
}

function firstSentence(text: string) {
  const s = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  return s.length ? s[0].slice(0, 240) : "";
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function addDays(d: Date, n: number) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}
function endOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(18, 0, 0, 0);
  return c;
}
function endOfWeek(d: Date) {
  const c = new Date(d);
  const delta = 7 - ((c.getDay() + 6) % 7) - 1; // week ends Sunday
  c.setDate(c.getDate() + delta);
  c.setHours(18, 0, 0, 0);
  return c;
}
