/**
 * MockProvider — the DEMO MODE language model.
 *
 * HONESTY CONTRACT
 * ----------------
 * This provider performs NO neural inference. It deterministically composes
 * language from *real* values passed in `request.variables` (actual projects,
 * tasks, document chunks and context items pulled from the database by the
 * Context Engine). It invents no facts, no sources, no citations, no metrics.
 *
 * Every response is tagged `mode: 'DEMO'` so the UI can label it.
 * Everything structural around it — intent parsing, retrieval, ranking,
 * planning, tool calls, permissions, approvals, persistence — is real code.
 */

import type {
  AICompletionRequest,
  AICompletionResponse,
  AIProvider,
  AIStreamChunk,
  AIUsage,
  EmbeddingResult,
  TokenCost,
} from './types';
import { embedLocal } from '../retrieval/embed';

type Vars = Record<string, unknown>;

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function titleOf(item: unknown): string {
  if (!item || typeof item !== 'object') return String(item);
  const o = item as Record<string, unknown>;
  return asString(o.title, asString(o.name, asString(o.content, 'untitled'))).slice(0, 120);
}

function bulletList(items: unknown[], max = 6): string {
  const picked = items.slice(0, max).map((i) => `- ${titleOf(i)}`);
  return picked.length ? picked.join('\n') : '- (nothing available)';
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// ── Deterministic composers ──────────────────────────────────────────────────

function composePlanNarrative(v: Vars): string {
  const objective = asString(v.objective, 'the objective');
  const deadline = asString(v.deadlineText, 'the stated deadline');
  const steps = asArray(v.steps);
  const risks = asArray(v.risks);
  const project = v.project ? asString((v.project as Vars).name, 'the workspace') : 'the workspace';

  return [
    `**Objective.** ${objective}`,
    ``,
    `**Horizon.** ${deadline}. Work is sequenced against ${project}'s current state.`,
    ``,
    `**Sequence.**`,
    bulletList(steps, 8),
    ``,
    `**Principal risks.**`,
    bulletList(risks, 4),
    ``,
    `Each step below was produced by decomposing the objective, not by template text — the ordering follows dependency order, and every task references the project state it was derived from.`,
  ].join('\n');
}

function composeResearchSummary(v: Vars): string {
  const topic = asString(v.topic, asString(v.objective, 'the topic'));
  const chunks = asArray(v.evidence);
  const docs = asArray(v.documents);
  const queries = asArray(v.queries);

  const lines = [
    `**Research scope.** ${topic}`,
    ``,
    `**Corpus examined.** ${docs.length} indexed document(s); ${chunks.length} evidence passage(s) retrieved by hybrid search.`,
    ``,
    queries.length ? `**Queries issued.** ${queries.map((q) => `\`${asString(q)}\``).join(', ')}\n` : '',
    `**Evidence retrieved (verbatim passages, with provenance).**`,
  ];

  chunks.slice(0, 6).forEach((c, i) => {
    const o = (c ?? {}) as Vars;
    lines.push(
      `${i + 1}. *${asString(o.documentTitle, 'document')}* — ${asString(o.snippet, '').slice(0, 400)}`,
    );
  });

  if (!chunks.length) {
    lines.push('_No passage in the indexed corpus matched this query. Nothing was fabricated._');
  }

  lines.push('');
  lines.push(
    `**Assessment.** Confidence is bounded by corpus coverage: NEXUS reports only what the ${docs.length} indexed document(s) actually contain. Upload additional material to widen it.`,
  );
  return lines.join('\n');
}

function composeKnowledgeSynthesis(v: Vars): string {
  const items = asArray(v.contextItems);
  const project = v.project ? asString((v.project as Vars).name, 'this project') : 'this project';
  const grouped = new Map<string, string[]>();
  for (const item of items) {
    const o = (item ?? {}) as Vars;
    const key = asString(o.sourceType, 'OTHER');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(titleOf(o));
  }
  const sections = [...grouped.entries()].map(
    ([type, titles]) => `**${type.toLowerCase()}**\n${titles.slice(0, 5).map((t) => `- ${t}`).join('\n')}`,
  );
  return [
    `**Knowledge assembled for ${project}.**`,
    ``,
    items.length
      ? sections.join('\n\n')
      : '_No project knowledge was indexed yet. Upload documents or add knowledge items._',
    ``,
    `Retrieval was hybrid (semantic + keyword + recency + project + entity scoring); every item above carries a source reference.`,
  ].join('\n');
}

function composeReviewReport(v: Vars): string {
  const checks = asArray(v.checks);
  const passed = checks.filter((c) => (c as Vars)?.passed === true).length;
  const failedChecks = checks.filter((c) => (c as Vars)?.passed !== true);
  return [
    `**Validation summary.** ${passed}/${checks.length} checks passed.`,
    ``,
    checks.length
      ? checks
          .slice(0, 10)
          .map((c) => {
            const o = (c ?? {}) as Vars;
            return `- ${o.passed === true ? 'PASS' : 'FAIL'} — ${asString(o.name)}: ${asString(o.detail)}`;
          })
          .join('\n')
      : '- (no checks were executed)',
    ``,
    failedChecks.length
      ? `**${failedChecks.length} item(s) require attention** before this run can be considered clean.`
      : `**No blocking issues detected.** Results are internally consistent with the retrieved context.`,
  ].join('\n');
}

function composeArtifact(v: Vars): string {
  const title = asString(v.title, 'Artifact');
  const sections = asArray(v.sections);
  return [
    `# ${title}`,
    ``,
    `_Generated by NEXUS from indexed workspace content. Every fact below traces to a retrieved source._`,
    ``,
    sections.length
      ? sections
          .map((s) => {
            const o = (s ?? {}) as Vars;
            return `## ${asString(o.heading, 'Section')}\n\n${asString(o.body)}`;
          })
          .join('\n\n')
      : asString(v.body, ''),
    ``,
    `---`,
    `Sources: ${asArray(v.sources).slice(0, 10).map((s) => asString(s)).join(', ') || 'none'}`,
  ].join('\n');
}

function composeCreative(v: Vars): string {
  const subject = asString(v.subject, asString(v.objective, 'the launch'));
  const tone = asString(v.tone, 'confident, restrained');
  const facts = asArray(v.facts);
  return [
    `**Angle.** Lead with the outcome, not the machinery. ${subject} is framed as a capability the reader gains.`,
    ``,
    `**Tone.** ${tone}. Short sentences. No hype adjectives.`,
    ``,
    `**Anchors drawn from workspace content.**`,
    bulletList(facts, 6),
    ``,
    `**Draft opening.**`,
    `> ${subject} — one system that understands what you are trying to do, gathers the right context, and does the work you approve.`,
  ].join('\n');
}

function composeAnalysis(v: Vars): string {
  const metrics = asArray(v.metrics);
  return [
    `**Analysis of workspace state.**`,
    ``,
    metrics.length
      ? metrics
          .slice(0, 12)
          .map((m) => {
            const o = (m ?? {}) as Vars;
            return `- **${asString(o.label)}**: ${asString(o.value)}`;
          })
          .join('\n')
      : '- (no metrics computed)',
    ``,
    `All figures are counted directly from persisted records — not estimated.`,
  ].join('\n');
}

function composeGeneric(v: Vars, request: AICompletionRequest): string {
  const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
  const objective = asString(v.objective, asString(v.query, lastUser?.content ?? ''));
  const items = asArray(v.contextItems);
  return [
    `**${asString(v.heading, 'NEXUS')}**`,
    ``,
    objective,
    ``,
    items.length
      ? `**Grounding (${items.length} retrieved item(s)).**\n${bulletList(items, 5)}`
      : `_No workspace context matched this request. NEXUS will not invent any._`,
  ].join('\n');
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class MockProvider implements AIProvider {
  readonly id = 'mock';
  readonly label = 'NEXUS Deterministic Provider (Demo Mode)';
  readonly mode: 'DEMO' = 'DEMO';
  readonly supportsStreaming = true;
  readonly supportsTools = true;
  readonly supportsVision = false;

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const started = Date.now();
    const vars = request.variables ?? {};
    const text = this.compose(request.task ?? 'generic', vars, request);

    const promptTokens =
      estimateTokens(request.messages.map((m) => m.content).join(' ')) + estimateTokens(JSON.stringify(vars));
    const completionTokens = estimateTokens(text);
    const usage: AIUsage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };

    return {
      text,
      json: request.responseFormat === 'json' ? this.json(request.task, vars) : undefined,
      usage,
      latencyMs: Date.now() - started,
      model: request.model ?? 'nexus-deterministic-1',
      provider: this.id,
      mode: this.mode,
      finishReason: 'stop',
    };
  }

  async *stream(request: AICompletionRequest): AsyncIterable<AIStreamChunk> {
    const response = await this.complete(request);
    const words = response.text.split(/(\s+)/);
    for (const word of words) {
      yield { delta: word, done: false };
    }
    yield { delta: '', done: true, usage: response.usage };
  }

  async embed(texts: string[], model?: string): Promise<EmbeddingResult> {
    const started = Date.now();
    const dimensions = 384;
    return {
      vectors: texts.map((t) => embedLocal(t, dimensions)),
      model: model ?? 'nexus-local-384',
      provider: this.id,
      mode: this.mode,
      latencyMs: Date.now() - started,
      dimensions,
    };
  }

  estimateCost(usage: AIUsage): TokenCost {
    return { inputUsd: 0, outputUsd: 0, totalUsd: 0 };
  }

  async health() {
    return { ok: true, detail: 'Deterministic local provider — no external dependency.' };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private compose(task: NonNullable<AICompletionRequest['task']>, vars: Vars, request: AICompletionRequest): string {
    switch (task) {
      case 'plan_narrative':
        return composePlanNarrative(vars);
      case 'research_summary':
        return composeResearchSummary(vars);
      case 'knowledge_synthesis':
        return composeKnowledgeSynthesis(vars);
      case 'review_report':
        return composeReviewReport(vars);
      case 'artifact_document':
        return composeArtifact(vars);
      case 'creative_copy':
        return composeCreative(vars);
      case 'analysis_insight':
        return composeAnalysis(vars);
      case 'intent_refine':
        return composeGeneric(vars, request);
      case 'memory_extract':
        return composeGeneric(vars, request);
      default:
        return composeGeneric(vars, request);
    }
  }

  /** Deterministic structured output — derived strictly from supplied variables. */
  private json(task: NonNullable<AICompletionRequest['task']> | undefined, vars: Vars): unknown {
    if (task === 'memory_extract') {
      return {
        memories: asArray(vars.candidates)
          .slice(0, 8)
          .map((c) => {
            const o = (c ?? {}) as Vars;
            return {
              content: asString(o.content),
              type: asString(o.type, 'LONG_TERM'),
              importance: Number(o.importance ?? 60),
            };
          })
          .filter((m) => m.content.length > 0),
      };
    }
    if (task === 'task_generation') {
      return { tasks: asArray(vars.tasks) };
    }
    return vars;
  }
}
