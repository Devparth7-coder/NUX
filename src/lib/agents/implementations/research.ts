import type { AgentDefinition } from '../types';
import { asArray, asRecord, markdownTable } from '../helpers';

interface Evidence {
  source: string;
  title: string;
  snippet: string;
  relevance: number;
  url?: string;
  documentId?: string;
}

export const researchAgent: AgentDefinition = {
  key: 'research',
  name: 'Research Agent',
  description: 'Discovers sources, extracts evidence, compares findings and summarises with provenance.',
  category: 'RESEARCH',
  capabilities: ['research', 'document_analysis'],
  allowedTools: ['documents.search', 'documents.read', 'documents.list', 'web.search', 'web.fetch', 'artifact.generate'],
  permissionLevel: 'READ',
  temperature: 0.3,
  maxTokens: 2400,
  icon: 'search',
  systemPrompt:
    'You research using real tools. You cite only retrieved passages and fetched pages. If the corpus has nothing relevant, you say so instead of inventing sources.',

  async execute(ctx) {
    // The objective may or may not begin with a verb, so use it whole.
    const subject = ctx.intent.objective || ctx.rawInput;
    const queries = [
      subject,
      ...ctx.intent.entities.slice(0, 2).map((e) => e.name),
      `${subject} risks`,
    ].filter((q): q is string => Boolean(q && q.length > 2));

    const evidence: Evidence[] = [];
    let toolCalls = 0;
    let tokens = 0;

    for (const query of queries.slice(0, 3)) {
      await ctx.emit('Searching indexed documents', query);
      const outcome = await ctx.callTool('documents.search', { query, limit: 5 });
      toolCalls++;
      if (outcome.status === 'COMPLETED') {
        for (const hit of asArray<Record<string, unknown>>(asRecord(outcome.result).hits)) {
          evidence.push({
            source: 'workspace document',
            title: String(hit.documentTitle ?? 'document'),
            snippet: String(hit.snippet ?? '').slice(0, 400),
            relevance: Number(hit.relevance ?? 0),
            documentId: hit.documentId ? String(hit.documentId) : undefined,
          });
        }
      }
    }

    // Live web sources — only when the intent actually calls for research.
    const wantsWeb = ctx.intent.requiredCapabilities.includes('research');
    let webResults: Record<string, unknown>[] = [];
    if (wantsWeb) {
      await ctx.emit('Searching the web', queries[0] ?? subject);
      const web = await ctx.callTool('web.search', { query: `${subject} launch strategy`, limit: 4 });
      toolCalls++;
      if (web.status === 'COMPLETED') {
        webResults = asArray<Record<string, unknown>>(asRecord(web.result).results);
        for (const r of webResults) {
          evidence.push({
            source: 'web',
            title: String(r.title ?? ''),
            snippet: String(r.snippet ?? '').slice(0, 300),
            relevance: 0.5,
            url: r.url ? String(r.url) : undefined,
          });
        }
      } else {
        await ctx.emit('Web search unavailable', String(asRecord(web.result).error ?? web.error ?? 'blocked'), 'FAILED');
      }
    }

    const unique = evidence
      .sort((a, b) => b.relevance - a.relevance)
      .filter((e, i, arr) => arr.findIndex((x) => x.title === e.title && x.snippet === e.snippet) === i)
      .slice(0, 10);

    const summary = await ctx.ai({
      task: 'research_summary',
      variables: {
        topic: subject,
        objective: ctx.intent.objective,
        queries,
        evidence: unique.map((e) => ({ documentTitle: e.title, snippet: e.snippet })),
        documents: [...new Set(unique.filter((e) => e.source === 'workspace document').map((e) => e.title))],
      },
    });
    tokens += summary.usage.totalTokens;

    const content = [
      `# Research — ${subject}`,
      '',
      summary.text,
      '',
      '## Evidence table',
      markdownTable(
        ['Source', 'Title', 'Relevance', 'Reference'],
        unique.map((e) => [e.source, e.title, e.relevance.toFixed(2), e.url ?? (e.documentId ? `document:${e.documentId.slice(0, 8)}` : '—')]),
      ),
      '',
      unique.length
        ? `_${unique.length} passage(s) retrieved. Every row above was returned by a tool call._`
        : '_No passage in the workspace or the live web matched these queries. Nothing was fabricated._',
    ].join('\n');

    const artifact = await ctx.callTool('artifact.generate', {
      title: `Research summary — ${subject}`,
      type: 'RESEARCH_SUMMARY',
      content,
      format: 'markdown',
      projectId: ctx.projectId ?? undefined,
    });
    toolCalls++;

    return {
      agentKey: 'research',
      summary: `Collected ${unique.length} evidence passage(s) from ${new Set(unique.map((e) => e.source)).size} source type(s).`,
      data: {
        queries,
        evidence: unique,
        webResultCount: webResults.length,
        artifactId: asRecord(artifact.result).id ?? null,
      },
      artifacts: [{ title: `Research summary — ${subject}`, type: 'RESEARCH_SUMMARY', content, format: 'markdown' }],
      toolCalls,
      tokens,
    };
  },
};
