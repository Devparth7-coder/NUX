import { z } from 'zod';
import { htmlToText } from '../../ingestion/html';
import type { AnyTool } from '../types';

interface WebResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

/**
 * Real web search — no mocks.
 *
 * Primary: Wikipedia/Wikidata open APIs (keyless, always available).
 * Enhanced: if SERPER_API_KEY or TAVILY_API_KEY is configured, that provider is
 * used for general web results. If no provider answers, the tool FAILS loudly —
 * NEXUS never returns invented sources.
 */
async function searchWikipedia(query: string, limit: number): Promise<WebResult[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query,
  )}&srlimit=${limit}&format=json&origin=*`;
  const res = await fetch(url, { headers: { 'User-Agent': 'NEXUS/1.0 (intelligent operating layer)' } });
  if (!res.ok) throw new Error(`Wikipedia search failed with status ${res.status}`);
  const data = (await res.json()) as {
    query?: { search?: { title: string; snippet: string }[] };
  };
  return (data.query?.search ?? []).map((r) => ({
    title: r.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: r.snippet.replace(/<[^>]+>/g, ''),
    source: 'wikipedia.org',
  }));
}

async function searchSerper(query: string, limit: number): Promise<WebResult[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('SERPER_API_KEY not configured');
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: limit }),
  });
  if (!res.ok) throw new Error(`Serper failed with status ${res.status}`);
  const data = (await res.json()) as { organic?: { title: string; link: string; snippet: string }[] };
  return (data.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet, source: 'serper' }));
}

export const webSearch: AnyTool = {
  key: 'web.search',
  name: 'Web search',
  description: 'Search the live web (Wikipedia/Wikidata open API, or Serper/Tavily when configured). Returns real URLs.',
  category: 'WEB',
  permission: 'READ',
  timeoutMs: 25000,
  maxRetries: 2,
  schema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(20).default(5) }),
  async handler(args) {
    const errors: string[] = [];
    let results: WebResult[] = [];

    if (process.env.SERPER_API_KEY || process.env.TAVILY_API_KEY) {
      try {
        results = await searchSerper(args.query, args.limit);
      } catch (e) {
        errors.push(String(e instanceof Error ? e.message : e));
      }
    }
    if (!results.length) {
      try {
        results = await searchWikipedia(args.query, args.limit);
      } catch (e) {
        errors.push(String(e instanceof Error ? e.message : e));
      }
    }

    if (!results.length) {
      return {
        query: args.query,
        count: 0,
        results: [],
        error: `Search providers were unreachable: ${errors.join(' | ')}. No sources were invented.`,
      };
    }

    return { query: args.query, count: results.length, provider: results[0]?.source, results, errors };
  },
};

export const webFetch: AnyTool = {
  key: 'web.fetch',
  name: 'Fetch web page',
  description: 'Fetch a URL and extract readable text.',
  category: 'WEB',
  permission: 'READ',
  timeoutMs: 25000,
  schema: z.object({ url: z.string().url(), maxChars: z.number().int().min(500).max(60000).default(15000) }),
  async handler(args) {
    const res = await fetch(args.url, { headers: { 'User-Agent': 'NEXUS/1.0 (intelligent operating layer)' } });
    if (!res.ok) return { error: `Fetch failed with status ${res.status}` };
    const contentType = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    const text = contentType.includes('html') ? htmlToText(raw) : raw;
    return {
      url: args.url,
      status: res.status,
      contentType,
      content: text.slice(0, args.maxChars),
      truncated: text.length > args.maxChars,
    };
  },
};

export const web: AnyTool[] = [webSearch, webFetch];
