/**
 * Intent Engine (§6).
 *
 * Turns natural language into a structured IntentObject.
 *
 * This is a real parser: it resolves entities against actual workspace records,
 * resolves relative dates against the current clock, infers capabilities from
 * linguistic signals, and scores its own confidence. It is deterministic and
 * fully testable. When a live model is configured, `refineWithModel()` can be
 * used to enrich the structured output — but the deterministic parse is the
 * contract, never the reverse.
 */

import type { Capability, IntentEntity, IntentObject, PermissionLevel, RiskLevel } from '@/types';
import { prisma } from '../db';

export interface IntentParseInput {
  rawInput: string;
  workspaceId: string;
  userId: string;
  projectId?: string | null;
  now?: Date;
}

interface ObjectiveRule {
  key: string;
  patterns: RegExp[];
  capabilities: Capability[];
  permissions: PermissionLevel[];
  risk: RiskLevel;
  outcome: (subject: string) => string;
}

const OBJECTIVE_RULES: ObjectiveRule[] = [
  {
    key: 'launch',
    patterns: [/\blaunch\b/i, /\bship\b/i, /\bgo[\s-]?live\b/i, /\brelease\b/i, /\broll\s?out\b/i],
    capabilities: ['planning', 'research', 'task_management', 'document_analysis', 'execution', 'review'],
    permissions: ['WRITE', 'EXTERNAL_ACTION'],
    risk: 'MEDIUM',
    outcome: (s) => `${s} is launched on schedule with every prerequisite verified.`,
  },
  {
    key: 'analyze',
    patterns: [/\banaly[sz]e\b/i, /\banalysis\b/i, /\breview the numbers\b/i, /\bmetrics\b/i, /\btrends?\b/i],
    capabilities: ['analysis', 'knowledge_retrieval', 'document_analysis', 'review'],
    permissions: ['READ'],
    risk: 'LOW',
    outcome: (s) => `A defensible analysis of ${s} with findings grounded in workspace data.`,
  },
  {
    key: 'research',
    patterns: [/\bresearch\b/i, /\bcompetitors?\b/i, /\bmarket\b/i, /\binvestigate\b/i, /\bfind out\b/i, /\bdiscover\b/i],
    capabilities: ['research', 'knowledge_retrieval', 'analysis', 'review'],
    permissions: ['READ'],
    risk: 'LOW',
    outcome: (s) => `Sourced research on ${s} with evidence and gaps identified.`,
  },
  {
    key: 'find',
    patterns: [/^find\b/i, /\bfind everything\b/i, /\bwhere is\b/i, /\blocate\b/i, /\bsearch for\b/i],
    capabilities: ['knowledge_retrieval', 'document_analysis'],
    permissions: ['READ'],
    risk: 'LOW',
    outcome: (s) => `Everything related to ${s}, retrieved with provenance.`,
  },
  {
    key: 'review',
    patterns: [/\breview\b/i, /\baudit\b/i, /\bcheck\b/i, /\bvalidate\b/i, /\bquality\b/i],
    capabilities: ['review', 'knowledge_retrieval', 'document_analysis'],
    permissions: ['READ', 'WRITE'],
    risk: 'LOW',
    outcome: (s) => `A review of ${s} with issues ranked by severity.`,
  },
  {
    key: 'prepare',
    patterns: [/\bprepare\b/i, /\bdraft\b/i, /\bcreate\b/i, /\bwrite\b/i, /\bbuild\b/i, /\bgenerate\b/i, /\bpresentation\b/i],
    capabilities: ['planning', 'creative', 'knowledge_retrieval', 'document_analysis', 'execution'],
    permissions: ['WRITE'],
    risk: 'LOW',
    outcome: (s) => `${s} is produced and ready to review.`,
  },
  {
    key: 'plan',
    patterns: [/\bplan\b/i, /\broadmap\b/i, /\bschedule\b/i, /\borgani[sz]e\b/i, /\bmilestones?\b/i],
    capabilities: ['planning', 'task_management', 'review'],
    permissions: ['WRITE'],
    risk: 'LOW',
    outcome: (s) => `A sequenced, dependency-aware plan for ${s}.`,
  },
  {
    key: 'execute',
    patterns: [/\bdeploy\b/i, /\bpublish\b/i, /\bsend\b/i, /\bemail\b/i, /\bpost\b/i, /\bcommit\b/i],
    capabilities: ['execution', 'integration', 'review'],
    permissions: ['EXTERNAL_ACTION', 'HIGH_IMPACT'],
    risk: 'HIGH',
    outcome: (s) => `${s} is executed against the target system.`,
  },
  {
    key: 'monitor',
    patterns: [/\bmonitor\b/i, /\btrack\b/i, /\bwatch\b/i, /\balert\b/i, /\bstatus\b/i],
    capabilities: ['analysis', 'knowledge_retrieval'],
    permissions: ['READ'],
    risk: 'LOW',
    outcome: (s) => `${s} is monitored with changes surfaced as they happen.`,
  },
];

const CONSTRAINT_PATTERNS = [
  /\bwithout\s+([^.,;]+)/i,
  /\bdo\s+not\s+([^.,;]+)/i,
  /\bdon'?t\s+([^.,;]+)/i,
  /\bonly\s+([^.,;]+)/i,
  /\bavoid\s+([^.,;]+)/i,
  /\bbudget\s+(?:of\s+)?([^.,;]+)/i,
  /\bmax(?:imum)?\s+([^.,;]+)/i,
  /\busing\s+([^.,;]+)/i,
];

const STOP_WORDS = new Set([
  'i', 'want', 'to', 'my', 'the', 'a', 'an', 'and', 'or', 'for', 'this', 'that', 'please', 'can', 'you',
  'me', 'we', 'us', 'it', 'is', 'are', 'be', 'with', 'from', 'into', 'about', 'need', 'should', 'would',
  'get', 'make', 'help', 'lets', "let's", 'our', 'on', 'in', 'of', 'all', 'everything', 'related', 'prepare',
]);

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/** Resolve a relative or absolute date expression. Returns null when none found. */
export function parseDeadline(text: string, now = new Date()): { date: Date; label: string } | null {
  const lower = text.toLowerCase();

  if (/\btoday\b/.test(lower)) return { date: endOfDay(now), label: 'Today' };
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { date: endOfDay(d), label: 'Tomorrow' };
  }
  if (/\byesterday\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return { date: endOfDay(d), label: 'Yesterday' };
  }

  const thisWeek = lower.match(/\bthis\s+week\b/);
  if (thisWeek) {
    // End of the working week: Friday 18:00. Once that moment has passed the
    // only honest reading is the *next* Friday — and the label must say so.
    const d = new Date(now);
    const day = d.getDay();
    const passed = day === 6 || day === 0 || (day === 5 && now.getHours() >= 18);
    const delta = passed ? ((5 - day + 7) % 7 || 7) : 5 - day;
    d.setDate(d.getDate() + delta);
    d.setHours(18, 0, 0, 0);
    return { date: d, label: passed ? 'Next Friday 18:00' : 'This week (Friday 18:00)' };
  }

  const nextWeek = lower.match(/\bnext\s+week\b/);
  if (nextWeek) {
    const d = new Date(now);
    const delta = (8 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + delta + 4);
    d.setHours(18, 0, 0, 0);
    return { date: d, label: 'Next week (Friday 18:00)' };
  }

  const inDays = lower.match(/\bin\s+(\d{1,3})\s+days?\b/);
  if (inDays?.[1]) {
    const d = new Date(now);
    d.setDate(d.getDate() + Number(inDays[1]));
    return { date: endOfDay(d), label: `In ${inDays[1]} days` };
  }

  const inWeeks = lower.match(/\bin\s+(\d{1,2})\s+weeks?\b/);
  if (inWeeks?.[1]) {
    const d = new Date(now);
    d.setDate(d.getDate() + Number(inWeeks[1]) * 7);
    return { date: endOfDay(d), label: `In ${inWeeks[1]} weeks` };
  }

  const byWeekday = lower.match(/\b(?:by|on|before|this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (byWeekday?.[1]) {
    const target = WEEKDAYS[byWeekday[1]]!;
    const d = new Date(now);
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    d.setDate(d.getDate() + delta);
    d.setHours(18, 0, 0, 0);
    return { date: d, label: `Next ${byWeekday[1][0]!.toUpperCase()}${byWeekday[1].slice(1)}` };
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T18:00:00`);
    if (!Number.isNaN(d.getTime())) return { date: d, label: `${iso[1]}-${iso[2]}-${iso[3]}` };
  }

  const endOfMonth = lower.match(/\bend\s+of\s+(?:the\s+)?month\b/);
  if (endOfMonth) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0, 18, 0, 0, 0);
    return { date: d, label: 'End of month' };
  }

  return null;
}

function extractSubject(raw: string, objectiveKey: string): string {
  let subject = raw
    .replace(/^(?:hey|hi|ok|okay|please)\b[,\s]*/i, '')
    .replace(/^i\s+(?:want|need|would like)\s+(?:you\s+)?to\s+/i, '')
    .replace(/^(?:can|could|would)\s+you\s+(?:please\s+)?/i, '')
    .replace(/^(?:prepare|plan|launch|analyze|analyse|research|review|create|build|find|draft|write|check|monitor|deploy|ship)\s+/i, '')
    .replace(/\b(?:this week|next week|today|tomorrow|by \w+day|in \d+ days?)\b\.?/gi, '')
    .replace(/\bfor me\b/gi, '')
    .replace(/^(?:my|our|your|the|a|an)\s+/i, '')
    .replace(/\s+(?:for|to|of|on|in|at|about|regarding|with|and|or)[.,;:!?\s]*$/i, '')
    .replace(/[.?!,;:\s]+$/, '')
    .trim();

  if (!subject) subject = `${objectiveKey} request`;
  subject = subject.charAt(0).toUpperCase() + subject.slice(1);

  return subject;
}

/** Lower-case the subject's first word when composing "verb subject", unless it is an acronym. */
function decapitalize(value: string): string {
  const [first = '', ...rest] = value.split(/\s+/);
  if (/^[A-Z]{2,}/.test(first) || /[A-Z]/.test(first.slice(1))) return value;
  return [first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(' ');
}

function matchRule(raw: string): { rule: ObjectiveRule; matched: boolean } {
  for (const rule of OBJECTIVE_RULES) {
    if (rule.patterns.some((p) => p.test(raw))) return { rule, matched: true };
  }
  return { rule: OBJECTIVE_RULES[5]!, matched: false }; // default: prepare
}

function keywords(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Parse an intent. Resolves entities against real workspace records — if a
 * project named in the request does not exist, no project entity is produced.
 */
export async function parseIntent(input: IntentParseInput): Promise<IntentObject> {
  const now = input.now ?? new Date();
  const raw = input.rawInput.trim();
  const { rule, matched } = matchRule(raw);
  const subject = extractSubject(raw, rule.key);

  // ── Entity resolution against the database ────────────────────────────────
  const entities: IntentEntity[] = [];
  const terms = keywords(raw);
  const uniqueTerms = [...new Set(terms)];

  const [projects, documents, tasks] = await Promise.all([
    prisma.project.findMany({
      where: { workspaceId: input.workspaceId },
      select: { id: true, name: true, slug: true },
    }),
    prisma.document.findMany({
      where: { workspaceId: input.workspaceId },
      select: { id: true, title: true },
      take: 200,
    }),
    prisma.task.findMany({
      where: { workspaceId: input.workspaceId },
      select: { id: true, title: true },
      take: 300,
    }),
  ]);

  let projectMatch: { id: string; name: string } | null = null;
  for (const project of projects) {
    const name = project.name.toLowerCase();
    const nameWords = name.split(/\s+/).filter((w) => w.length > 2);
    const hit = raw.toLowerCase().includes(name) || nameWords.every((w) => raw.toLowerCase().includes(w));
    if (hit) {
      projectMatch = { id: project.id, name: project.name };
      entities.push({ name: project.name, type: 'PROJECT', value: project.id, confidence: 0.95 });
      break;
    }
  }
  if (!projectMatch && input.projectId) {
    const scoped = projects.find((p) => p.id === input.projectId);
    if (scoped) projectMatch = { id: scoped.id, name: scoped.name };
  }

  for (const doc of documents) {
    if (raw.toLowerCase().includes(doc.title.toLowerCase()) && doc.title.length > 3) {
      entities.push({ name: doc.title, type: 'DOCUMENT', value: doc.id, confidence: 0.9 });
    }
  }

  for (const task of tasks) {
    if (raw.toLowerCase().includes(task.title.toLowerCase()) && task.title.length > 3) {
      entities.push({ name: task.title, type: 'TASK', value: task.id, confidence: 0.85 });
    }
  }

  // Quoted phrases are treated as explicit entities.
  for (const quoted of raw.match(/"([^"]{2,60})"/g) ?? []) {
    const clean = quoted.replace(/"/g, '');
    if (!entities.some((e) => e.name.toLowerCase() === clean.toLowerCase())) {
      entities.push({ name: clean, type: 'CONCEPT', value: clean, confidence: 0.8 });
    }
  }

  // Capitalised sequences (proper nouns) not already captured.
  for (const phrase of raw.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?/g) ?? []) {
    if (STOP_WORDS.has(phrase.toLowerCase())) continue;
    if (entities.some((e) => e.name === phrase)) continue;
    if (phrase.length < 3) continue;
    entities.push({ name: phrase, type: 'CONCEPT', value: phrase, confidence: 0.55 });
  }

  // ── Constraints ───────────────────────────────────────────────────────────
  const constraints: string[] = [];
  for (const pattern of CONSTRAINT_PATTERNS) {
    const m = raw.match(pattern);
    if (m?.[1]) constraints.push(m[1].trim().slice(0, 120));
  }

  // ── Deadline ──────────────────────────────────────────────────────────────
  const deadline = parseDeadline(raw, now);

  // ── Capabilities & permissions ────────────────────────────────────────────
  const capabilities = new Set<Capability>(rule.capabilities);
  const permissions = new Set<PermissionLevel>(rule.permissions);

  if (/\bdocument|paper|pdf|report|spec/i.test(raw)) capabilities.add('document_analysis');
  if (/\bknowledge|everything related|context/i.test(raw)) capabilities.add('knowledge_retrieval');
  if (/\bcompetitor|market|research/i.test(raw)) capabilities.add('research');
  if (/\bemail|calendar|github|slack|notion|drive/i.test(raw)) {
    capabilities.add('integration');
    permissions.add('EXTERNAL_ACTION');
  }
  if (/\bdelete|destroy|drop|remove production|overwrite/i.test(raw)) permissions.add('HIGH_IMPACT');
  if (deadline) capabilities.add('planning');

  let riskLevel: RiskLevel = rule.risk;
  if (permissions.has('HIGH_IMPACT')) riskLevel = 'HIGH';
  else if (permissions.has('EXTERNAL_ACTION') && deadline) riskLevel = 'HIGH';
  else if (deadline && rule.key === 'launch') riskLevel = 'MEDIUM';

  // ── Confidence: how many real signals did we actually resolve? ────────────
  let confidence = matched ? 0.55 : 0.3;
  if (projectMatch) confidence += 0.2;
  if (deadline) confidence += 0.1;
  if (entities.length) confidence += 0.08;
  if (constraints.length) confidence += 0.05;
  if (uniqueTerms.length >= 4) confidence += 0.05;
  confidence = Math.max(0.1, Math.min(0.99, confidence));

  // Avoid "launch NEXUS launch": when the subject already carries the objective
  // verb, the subject alone states the objective most clearly.
  const objective = new RegExp(`\\b${rule.key}\\b`, 'i').test(subject) ? subject : `${rule.key} ${decapitalize(subject)}`.trim();

  return {
    objective,
    desiredOutcome: rule.outcome(subject),
    entities,
    constraints,
    deadline: deadline?.date ?? null,
    deadlineText: deadline?.label ?? null,
    projectContext: projectMatch?.id ?? input.projectId ?? null,
    requiredCapabilities: [...capabilities],
    riskLevel,
    permissionsRequired: [...permissions],
    confidence: Number(confidence.toFixed(2)),
    parser: 'rules',
  };
}
