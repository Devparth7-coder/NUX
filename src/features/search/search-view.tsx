'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FileText, Hash, Search, Sparkles } from 'lucide-react';
import { Badge, STATUS_TONE } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { fetchJson } from '@/hooks/use-session';
import { cn, relativeTime } from '@/lib/utils';

interface SearchResult {
  id: string;
  type: string;
  title: string;
  snippet: string;
  relevance: number;
  projectId: string | null;
  projectName: string | null;
  timestamp: string | null;
  source: string;
  href: string | null;
}

const TYPES = ['ALL', 'PROJECT', 'DOCUMENT', 'TASK', 'KNOWLEDGE', 'MEMORY', 'CONVERSATION', 'AGENT', 'ACTIVITY'] as const;

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  PROJECT: Hash,
  DOCUMENT: FileText,
  TASK: Hash,
  KNOWLEDGE: Sparkles,
  MEMORY: Sparkles,
  CONVERSATION: Search,
  AGENT: Sparkles,
  ACTIVITY: Hash,
};

export function SearchView({ initialQuery = '' }: { initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = React.useState(initialQuery);
  const [debounced, setDebounced] = React.useState(initialQuery);
  const [type, setType] = React.useState<string>('ALL');

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 220);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => fetchJson<{ query: string; results: SearchResult[]; total: number }>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.trim().length >= 2,
  });

  const results = React.useMemo(() => {
    const all = data?.results ?? [];
    return type === 'ALL' ? all : all.filter((r) => r.type === type);
  }, [data, type]);

  return (
    <div className="mx-auto max-w-[1000px] space-y-5">
      <header>
        <p className="label">Search</p>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">Search the workspace</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          Hybrid retrieval across projects, documents, tasks, knowledge, memory, conversations, agents and activity.
          Document and knowledge hits are ranked semantically with the live embedding provider — nothing is invented, every
          result links back to its record.
        </p>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects, documents, tasks, knowledge, memory…"
          className="h-12 pl-10 text-[15px]"
          autoFocus
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((entry) => (
          <button
            key={entry}
            onClick={() => setType(entry)}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors',
              type === entry ? 'border-accent/40 bg-accent/10 text-ink' : 'border-line bg-surface-2/40 text-ink-muted hover:bg-surface-3/50',
            )}
          >
            {entry.charAt(0) + entry.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {debounced.trim().length < 2 ? (
        <EmptyState icon={Search} title="Type at least two characters" description="Search runs hybrid semantic + keyword retrieval." />
      ) : results.length ? (
        <div className="space-y-2">
          {results.map((result) => {
            const Icon = TYPE_ICON[result.type] ?? Hash;
            const content = (
              <Card className="px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-3/40">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-ink">{result.title}</span>
                      <Badge variant="outline">{result.type.toLowerCase()}</Badge>
                      <span className="text-2xs text-ink-faint">{Math.round(result.relevance * 100)}% match</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-muted">{result.snippet}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-ink-faint">
                      <span>via {result.source}</span>
                      {result.projectName ? <span>· {result.projectName}</span> : null}
                      {result.timestamp ? <span>· {relativeTime(result.timestamp)}</span> : null}
                    </div>
                  </div>
                </div>
              </Card>
            );
            return result.href ? (
              <Link key={`${result.type}-${result.id}`} href={result.href} className="block">
                {content}
              </Link>
            ) : (
              <div key={`${result.type}-${result.id}`}>{content}</div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title={isFetching ? 'Searching…' : `No results for “${debounced}”`}
          description={isFetching ? undefined : 'Try a different term, or index more documents in Projects → Intelligence.'}
        />
      )}
    </div>
  );
}
