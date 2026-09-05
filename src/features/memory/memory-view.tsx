'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain, Eye, EyeOff, Pin, Plus, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Callout, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { cn, relativeTime } from '@/lib/utils';

interface MemoryRow {
  id: string;
  type: string;
  content: string;
  source: string;
  confidence: number;
  importance: number;
  scope: string;
  enabled: boolean;
  pinned: boolean;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
}

const TYPES = ['SHORT_TERM', 'PROJECT', 'LONG_TERM', 'EXPLICIT', 'EPISODIC'];

export function MemoryView() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [query, setQuery] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ content: '', type: 'LONG_TERM', importance: 60 });

  const { data, isLoading } = useQuery({
    queryKey: ['memory', query, typeFilter],
    queryFn: () =>
      fetchJson<{ items: MemoryRow[]; total: number; hits?: { memory: MemoryRow; score: number }[]; mode: string }>(
        `/api/memory${query ? `?q=${encodeURIComponent(query)}` : typeFilter ? `?type=${typeFilter}` : ''}`,
      ),
  });

  const rows = React.useMemo(() => {
    if (data?.mode === 'semantic' && data.hits) return data.hits.map((h) => h.memory);
    return data?.items ?? [];
  }, [data]);

  async function create() {
    if (form.content.trim().length < 4) return;
    setSaving(true);
    try {
      await fetchJson('/api/memory', { method: 'POST', body: JSON.stringify(form) });
      push({ title: 'Memory saved', tone: 'success' });
      setCreating(false);
      setForm({ content: '', type: 'LONG_TERM', importance: 60 });
      await qc.invalidateQueries({ queryKey: ['memory'] });
    } catch (error) {
      push({ title: 'Could not save memory', description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetchJson(`/api/memory/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    await qc.invalidateQueries({ queryKey: ['memory'] });
  }

  async function remove(id: string) {
    await fetchJson(`/api/memory/${id}`, { method: 'DELETE' });
    push({ title: 'Memory deleted', tone: 'info' });
    await qc.invalidateQueries({ queryKey: ['memory'] });
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Memory</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">What NEXUS remembers</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Four layers — short term, project, long term and explicit. Retrieval is hybrid; duplicates are merged;
            low-value entries are pruned automatically. You can edit, disable or delete any of it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Semantic search memory"
              className="h-9 w-56 pl-9"
            />
          </div>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 w-40">
            <option value="">All layers</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </Select>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Save memory
          </Button>
        </div>
      </header>

      {query.trim().length >= 2 ? (
        <Callout tone="info" title="Semantic retrieval">
          Results are ranked by hybrid score (semantic + keyword + recency + importance). Items that match are marked as
          accessed, which feeds the memory lifecycle.
        </Callout>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      ) : rows.length ? (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {rows.map((memory) => (
              <motion.div
                key={memory.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: memory.enabled ? 1 : 0.5, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className={cn(
                  'group rounded-xl border p-4 transition-colors',
                  memory.pinned ? 'border-violet/30 bg-violet/[0.04]' : 'border-line bg-surface-2/40 hover:border-line-strong',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={memory.type === 'EXPLICIT' ? 'violet' : memory.type === 'PROJECT' ? 'accent' : 'default'}>
                    {memory.type.replace('_', ' ').toLowerCase()}
                  </Badge>
                  <span className="text-2xs text-ink-faint">source · {memory.source.toLowerCase()}</span>
                  {memory.pinned ? <Pin className="h-3 w-3 text-violet-soft" /> : null}
                  <span className="ml-auto flex items-center gap-3">
                    <span className="font-mono text-2xs text-ink-faint">importance {memory.importance}</span>
                    <span className="font-mono text-2xs text-ink-faint">{(memory.confidence * 100).toFixed(0)}%</span>
                  </span>
                </div>

                <p className="mt-2 text-[13.5px] leading-relaxed text-ink">{memory.content}</p>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line-faint pt-2.5">
                  <span className="text-2xs text-ink-faint">
                    {memory.accessCount} access{memory.accessCount === 1 ? '' : 'es'} · updated {relativeTime(memory.updatedAt)}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-2xs"
                      onClick={() => void patch(memory.id, { pinned: !memory.pinned })}
                    >
                      <Pin className="h-3 w-3" /> {memory.pinned ? 'Unpin' : 'Pin'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-2xs"
                      onClick={() => void patch(memory.id, { enabled: !memory.enabled })}
                    >
                      {memory.enabled ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {memory.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-2xs" onClick={() => void remove(memory.id)}>
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <EmptyState
          icon={Brain}
          title="No memories in this layer"
          description="NEXUS saves durable facts after each run: objectives, decisions and outcomes. You can also save memory explicitly."
          action={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Save memory
            </Button>
          }
        />
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Save memory"
        description="Explicit memories are pinned to your intent and never pruned automatically."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={create}>
              Save memory
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label mb-1.5 block">Layer</span>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Content</span>
            <Textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={4}
              placeholder="Prefers weekly summaries on Monday morning."
            />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Importance · {form.importance}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={form.importance}
              onChange={(e) => setForm({ ...form, importance: Number(e.target.value) })}
              className="w-full accent-[#3D7EFF]"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
