'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { KnowledgeGraph, type GraphEdgeData, type GraphNodeData } from './knowledge-graph';

interface KnowledgeItem {
  id: string;
  title: string;
  content: string | null;
  type: string;
  confidence: number;
  source: string;
  projectId: string | null;
}

export function KnowledgeView() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [query, setQuery] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ title: '', content: '', type: 'CONCEPT' });

  const { data, isLoading } = useQuery({
    queryKey: ['knowledge'],
    queryFn: () => fetchJson<{ items: KnowledgeItem[]; relations: { id: string; fromId: string; toId: string; type: string; weight: number }[] }>('/api/knowledge'),
  });

  const items = (data?.items ?? []).filter((item) => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (!query) return true;
    return `${item.title} ${item.content ?? ''}`.toLowerCase().includes(query.toLowerCase());
  });

  const nodes: GraphNodeData[] = items.slice(0, 80).map((i) => ({ id: i.id, title: i.title, type: i.type, confidence: i.confidence }));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: GraphEdgeData[] = (data?.relations ?? [])
    .filter((r) => nodeIds.has(r.fromId) && nodeIds.has(r.toId))
    .map((r) => ({ id: r.id, fromId: r.fromId, toId: r.toId, type: r.type, weight: r.weight }));

  async function create() {
    if (form.title.trim().length < 2) return;
    setSaving(true);
    try {
      await fetchJson('/api/knowledge', { method: 'POST', body: JSON.stringify(form) });
      push({ title: 'Knowledge item created', description: form.title, tone: 'success' });
      setCreating(false);
      setForm({ title: '', content: '', type: 'CONCEPT' });
      await qc.invalidateQueries({ queryKey: ['knowledge'] });
    } catch (error) {
      push({ title: 'Could not create item', description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Knowledge</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">What the workspace knows</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Entities and relationships are derived from ingested documents and explicit entries. No relationship is
            invented — every edge traces to real content.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter knowledge" className="h-9 w-52 pl-9" />
          </div>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 w-40">
            <option value="">All types</option>
            {['PROJECT', 'PERSON', 'DOCUMENT', 'TASK', 'CONCEPT', 'DECISION', 'TECHNOLOGY', 'ORGANIZATION'].map((t) => (
              <option key={t} value={t}>
                {t.toLowerCase()}
              </option>
            ))}
          </Select>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="skeleton h-[520px] rounded-xl" />
      ) : (
        <>
          <KnowledgeGraph nodes={nodes} edges={edges} />

          <Card>
            <CardHeader>
              <CardTitle className="text-[14px]">Knowledge items</CardTitle>
              <span className="font-mono text-2xs text-ink-faint">{items.length} items</span>
            </CardHeader>
            <CardContent>
              {items.length ? (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((item) => (
                    <div key={item.id} className="rounded-lg border border-line bg-surface-2/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline">{item.type.toLowerCase()}</Badge>
                        <span className="font-mono text-2xs text-ink-faint">{(item.confidence * 100).toFixed(0)}%</span>
                      </div>
                      <p className="mt-2 text-[13.5px] font-medium leading-snug text-ink">{item.title}</p>
                      {item.content ? <p className="mt-1 line-clamp-3 text-2xs leading-relaxed text-ink-muted">{item.content}</p> : null}
                      <p className="mt-2 text-2xs text-ink-faint">source: {item.source.toLowerCase()}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No knowledge items" description="Upload documents or add knowledge to build the graph." />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add knowledge item"
        description="Explicit knowledge is stored with full provenance and becomes retrievable by every agent."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={create}>
              Add item
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label mb-1.5 block">Title</span>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Launch positioning" />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Type</span>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {['PROJECT', 'PERSON', 'DOCUMENT', 'TASK', 'CONCEPT', 'DECISION', 'TECHNOLOGY', 'ORGANIZATION'].map((t) => (
                <option key={t} value={t}>
                  {t.toLowerCase()}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Content</span>
            <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} />
          </label>
        </div>
      </Modal>
    </div>
  );
}
