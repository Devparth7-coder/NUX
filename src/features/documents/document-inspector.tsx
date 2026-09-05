'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { fetchJson } from '@/hooks/use-session';
import { EmptyState } from '@/components/ui/misc';

interface Chunk {
  id: string;
  content: string;
  page: number;
  section: string | null;
  position: number;
  tokenCount: number;
}

export function DocumentInspector({ documentId, chunks }: { documentId: string; chunks: Chunk[] }) {
  const [query, setQuery] = React.useState('');
  const [filtered, setFiltered] = React.useState<Chunk[] | null>(null);
  const [searching, setSearching] = React.useState(false);

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setFiltered(null);
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await fetchJson<{ passages: { chunkId: string; content: string; relevance: number }[] }>(
          `/api/documents/${documentId}?q=${encodeURIComponent(query)}`,
        );
        setFiltered(
          data.passages.map((p) => ({
            id: p.chunkId,
            content: p.content,
            page: chunks.find((c) => c.id === p.chunkId)?.page ?? 1,
            section: chunks.find((c) => c.id === p.chunkId)?.section ?? null,
            position: chunks.find((c) => c.id === p.chunkId)?.position ?? 0,
            tokenCount: chunks.find((c) => c.id === p.chunkId)?.tokenCount ?? 0,
          })),
        );
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [query, documentId, chunks]);

  const visible = filtered ?? chunks;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[14px]">Indexed chunks</CardTitle>
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Semantic search in this document"
            className="h-8 pl-9 text-[13px]"
          />
        </div>
      </CardHeader>
      <CardContent>
        {visible.length ? (
          <div className="max-h-[600px] space-y-2 overflow-y-auto pr-1">
            {visible.map((chunk) => (
              <div key={chunk.id} className="rounded-lg border border-line bg-surface-2/40 p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">#{chunk.position}</Badge>
                  <span className="text-2xs text-ink-faint">page {chunk.page}</span>
                  {chunk.section ? <span className="text-2xs text-ink-muted">{chunk.section}</span> : null}
                  <span className="ml-auto font-mono text-2xs text-ink-faint">{chunk.tokenCount} tok</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-muted">{chunk.content}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No matching passages" description="Try a different query, or check that this document finished indexing." />
        )}
        {searching ? <p className="mt-2 text-2xs text-ink-faint">Searching…</p> : null}
      </CardContent>
    </Card>
  );
}
