"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Brain, Network, Search, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, titleCase, truncate } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";

type KnowledgeItem = {
  id: string;
  label: string;
  kind: string;
  content: string;
  confidence: number;
  source: string;
  createdAt: string;
  project: { id: string; name: string } | null;
  document: { id: string; title: string } | null;
};

type Relation = { id: string; sourceId: string; targetId: string; type: string; weight: number; evidence: string | null };

const KIND_COLOR: Record<string, string> = {
  FACT: "#60A5FA",
  DECISION: "#8B5CF6",
  CONCEPT: "#34D399",
  PERSON: "#F472B6",
  ORGANIZATION: "#22D3EE",
  TECHNOLOGY: "#F59E0B",
  RISK: "#EF4444",
  INSIGHT: "#A3E635",
};

export default function KnowledgePage() {
  const { toast } = useToast();
  const reduceMotion = useUIStore((s) => s.reducedMotion);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({ label: "", content: "", kind: "FACT" });

  const { data, isLoading } = useQuery({
    queryKey: ["knowledge"],
    queryFn: () => api.get<{ items: KnowledgeItem[]; relations: Relation[]; matches: Array<{ id: string; label: string; score: number; why: string[] }> }>("/api/knowledge"),
  });

  const filtered = React.useMemo(() => {
    const items = data?.items ?? [];
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.content.toLowerCase().includes(q));
  }, [data, query]);

  async function create() {
    if (form.label.trim().length < 2 || form.content.trim().length < 4) return;
    try {
      await api.post("/api/knowledge", form);
      toast({ tone: "success", title: "Knowledge item added" });
      setCreating(false);
      setForm({ label: "", content: "", kind: "FACT" });
    } catch (err) {
      toast({ tone: "error", title: "Could not add item", body: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-8 md:px-8">
      <PageHeader
        title="Knowledge"
        description="A live graph of facts, decisions, concepts and risks extracted from your documents and runs. Nothing in this graph is invented."
        actions={
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> Add item
          </Button>
        }
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>Graph</CardTitle>
              <p className="text-[11.5px] text-mute mt-1">
                {data?.items?.length ?? 0} nodes · {data?.relations?.length ?? 0} relations
              </p>
            </div>
            <Badge tone="violet">
              <Network className="h-3 w-3" /> Knowledge graph
            </Badge>
          </CardHeader>
          <CardContent className="pt-3">
            {isLoading ? (
              <LoadingRows rows={3} />
            ) : (data?.items?.length ?? 0) > 0 ? (
              <KnowledgeGraph
                items={filtered}
                relations={(data?.relations ?? []).filter(
                  (r) => filtered.some((i) => i.id === r.sourceId) && filtered.some((i) => i.id === r.targetId),
                )}
                selected={selected}
                onSelect={setSelected}
                reduceMotion={reduceMotion}
              />
            ) : (
              <EmptyState icon={Brain} title="No knowledge yet" description="Ingest documents or run an intent to build knowledge." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter knowledge…" className="pl-9" />
            </div>
          </CardHeader>
          <CardContent className="max-h-[560px] space-y-2 overflow-y-auto pt-3">
            {filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelected(item.id)}
                className={cn(
                  "w-full rounded-[10px] border bg-surface-1 p-3 text-left transition-colors",
                  selected === item.id ? "border-accent/40 bg-surface-2" : "border-line hover:border-line-strong",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[item.kind] ?? "#64748B" }} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{item.label}</span>
                  <Badge tone="neutral">{titleCase(item.kind)}</Badge>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-mute">{truncate(item.content, 130)}</p>
                <div className="mt-2 flex items-center gap-2 text-[10.5px] text-mute">
                  <span>confidence {item.confidence.toFixed(2)}</span>
                  {item.document ? (
                    <Link href={`/documents?doc=${item.document.id}`} className="hover:text-ink">
                      {truncate(item.document.title, 28)}
                    </Link>
                  ) : null}
                </div>
              </button>
            ))}
            {!filtered.length ? <p className="py-8 text-center text-[12px] text-mute">No items match.</p> : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="Add knowledge item" description="Explicit knowledge is stored with provenance and indexed for retrieval.">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="k-label">Label</Label>
              <Input id="k-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Launch strategy" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="k-kind">Kind</Label>
              <Select id="k-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {Object.keys(KIND_COLOR).map((kind) => (
                  <option key={kind} value={kind}>
                    {titleCase(kind)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="k-content">Content</Label>
              <Textarea id="k-content" rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={create}>
                Add item
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Lightweight force-directed layout computed in the browser from real graph data. */
function KnowledgeGraph({
  items,
  relations,
  selected,
  onSelect,
  reduceMotion,
}: {
  items: KnowledgeItem[];
  relations: Relation[];
  selected: string | null;
  onSelect: (id: string) => void;
  reduceMotion: boolean;
}) {
  const [positions, setPositions] = React.useState<Record<string, { x: number; y: number }>>({});
  const size = 460;

  React.useEffect(() => {
    if (!items.length || reduceMotion) {
      // Deterministic circular layout when motion is reduced.
      const next: Record<string, { x: number; y: number }> = {};
      items.forEach((item, index) => {
        const angle = (index / Math.max(1, items.length)) * Math.PI * 2;
        next[item.id] = { x: size / 2 + Math.cos(angle) * (size / 3), y: size / 2 + Math.sin(angle) * (size / 3) };
      });
      setPositions(next);
      return;
    }

    const nodes = items.map((item, index) => ({
      id: item.id,
      x: size / 2 + Math.cos(index * 2.399) * 90,
      y: size / 2 + Math.sin(index * 2.399) * 90,
      vx: 0,
      vy: 0,
    }));
    const byId = new Map(nodes.map((n) => [n.id, n]));

    let frame = 0;
    const step = () => {
      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(24, Math.hypot(dx, dy));
          const force = 2600 / (dist * dist);
          const ux = dx / dist;
          const uy = dy / dist;
          a.vx -= ux * force;
          a.vy -= uy * force;
          b.vx += ux * force;
          b.vy += uy * force;
        }
      }
      // Springs
      for (const rel of relations) {
        const a = byId.get(rel.sourceId);
        const b = byId.get(rel.targetId);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = (dist - 110) * 0.012;
        const ux = dx / dist;
        const uy = dy / dist;
        a.vx += ux * force;
        a.vy += uy * force;
        b.vx -= ux * force;
        b.vy -= uy * force;
      }
      // Gravity + integrate
      for (const node of nodes) {
        node.vx += (size / 2 - node.x) * 0.004;
        node.vy += (size / 2 - node.y) * 0.004;
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.x = Math.max(28, Math.min(size - 28, node.x + node.vx));
        node.y = Math.max(28, Math.min(size - 28, node.y + node.vy));
      }
      setPositions(Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }])));
      if (frame++ < 220) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, relations.length, reduceMotion, size]);

  return (
    <div className="relative overflow-hidden rounded-[12px] border border-line bg-[radial-gradient(circle_at_50%_40%,rgba(59,130,246,0.06),transparent_60%)]">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-[460px] w-full" role="img" aria-label="Knowledge graph">
        {relations.map((rel) => {
          const a = positions[rel.sourceId];
          const b = positions[rel.targetId];
          if (!a || !b) return null;
          const active = selected === rel.sourceId || selected === rel.targetId;
          return (
            <line
              key={rel.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={active ? "rgba(139,92,246,0.65)" : "rgba(255,255,255,0.11)"}
              strokeWidth={active ? 1.6 : 1}
            />
          );
        })}
        {items.map((item) => {
          const pos = positions[item.id];
          if (!pos) return null;
          const color = KIND_COLOR[item.kind] ?? "#64748B";
          const isSelected = selected === item.id;
          return (
            <g key={item.id} transform={`translate(${pos.x} ${pos.y})`} onClick={() => onSelect(item.id)} className="cursor-pointer">
              <circle r={isSelected ? 9 : 6.5} fill={color} fillOpacity={isSelected ? 0.95 : 0.65} stroke={color} strokeOpacity={0.9} />
              {isSelected ? <circle r={14} fill="none" stroke={color} strokeOpacity={0.35} /> : null}
              <text y={20} textAnchor="middle" className="fill-[rgba(232,234,240,0.75)] text-[9px]">
                {item.label.length > 22 ? `${item.label.slice(0, 22)}…` : item.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute bottom-2 left-3 flex flex-wrap gap-2">
        {Object.entries(KIND_COLOR).map(([kind, color]) => (
          <span key={kind} className="inline-flex items-center gap-1.5 text-[10px] text-mute">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            {titleCase(kind)}
          </span>
        ))}
      </div>
    </div>
  );
}
