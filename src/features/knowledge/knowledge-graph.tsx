'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Network } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export interface GraphNodeData {
  id: string;
  title: string;
  type: string;
  confidence: number;
}

export interface GraphEdgeData {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  weight: number;
}

const TYPE_COLOR: Record<string, string> = {
  PROJECT: '#3D7EFF',
  PERSON: '#38D39F',
  DOCUMENT: '#8B6CFF',
  TASK: '#F5B544',
  CONCEPT: '#6E9BFF',
  DECISION: '#FF5C6C',
  TECHNOLOGY: '#A995FF',
  ORGANIZATION: '#7FD1C1',
};

/**
 * Deterministic radial cluster layout — no physics simulation, so the graph is
 * stable across renders (and honest: positions carry no meaning beyond grouping).
 */
export function KnowledgeGraph({
  nodes,
  edges,
  onSelect,
}: {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  onSelect?: (node: GraphNodeData | null) => void;
}) {
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);

  const layout = React.useMemo(() => {
    const groups = new Map<string, GraphNodeData[]>();
    for (const node of nodes) {
      if (!groups.has(node.type)) groups.set(node.type, []);
      groups.get(node.type)!.push(node);
    }

    const positions = new Map<string, { x: number; y: number }>();
    const types = [...groups.keys()];
    const radius = 210;

    types.forEach((type, typeIndex) => {
      const angle = (typeIndex / types.length) * Math.PI * 2 - Math.PI / 2;
      const cx = 400 + Math.cos(angle) * radius;
      const cy = 330 + Math.sin(angle) * radius;
      const items = groups.get(type)!;
      items.forEach((node, index) => {
        const spread = Math.max(60, items.length * 13);
        const localAngle = (index / Math.max(1, items.length)) * Math.PI * 2;
        positions.set(node.id, {
          x: cx + Math.cos(localAngle) * spread,
          y: cy + Math.sin(localAngle) * spread,
        });
      });
    });

    return positions;
  }, [nodes]);

  const focus = hovered ?? selected;
  const connected = React.useMemo(() => {
    if (!focus) return null;
    const set = new Set<string>([focus]);
    for (const edge of edges) {
      if (edge.fromId === focus) set.add(edge.toId);
      if (edge.toId === focus) set.add(edge.fromId);
    }
    return set;
  }, [focus, edges]);

  if (!nodes.length) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Network}
            title="The knowledge graph is empty"
            description="Relationships are created only from ingested content: documents, entities and project structure. Nothing is inferred."
          />
        </CardContent>
      </Card>
    );
  }

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[14px]">
          <Network className="h-3.5 w-3.5 text-ink-faint" /> Knowledge graph
        </CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {[...new Set(nodes.map((n) => n.type))].map((type) => (
            <Badge key={type} variant="outline" className="gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: TYPE_COLOR[type] ?? '#6E9BFF' }} />
              {type.toLowerCase()}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-xl border border-line bg-surface-2/30">
          <svg viewBox="0 0 800 660" className="h-[460px] w-full sm:h-[560px]">
            <defs>
              <radialGradient id="kg-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(61,126,255,0.10)" />
                <stop offset="100%" stopColor="rgba(61,126,255,0)" />
              </radialGradient>
            </defs>
            <rect width="800" height="660" fill="url(#kg-glow)" />

            {/* Edges */}
            {edges.map((edge) => {
              const a = layout.get(edge.fromId);
              const b = layout.get(edge.toId);
              if (!a || !b) return null;
              const active = !connected || (connected.has(edge.fromId) && connected.has(edge.toId));
              return (
                <line
                  key={edge.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={active ? 'rgba(139,108,255,0.55)' : 'rgba(255,255,255,0.05)'}
                  strokeWidth={active ? 1.4 : 0.6}
                  strokeLinecap="round"
                />
              );
            })}

            {/* Nodes */}
            {nodes.map((node, index) => {
              const pos = layout.get(node.id);
              if (!pos) return null;
              const color = TYPE_COLOR[node.type] ?? '#6E9BFF';
              const isFocus = focus === node.id;
              const dim = connected ? !connected.has(node.id) : false;
              const radius = 5 + Math.min(6, node.confidence * 6);

              return (
                <motion.g
                  key={node.id}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: dim ? 0.25 : 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: Math.min(index * 0.008, 0.4) }}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => {
                    setSelected(node.id === selected ? null : node.id);
                    onSelect?.(node.id === selected ? null : node);
                  }}
                >
                  {isFocus ? <circle cx={pos.x} cy={pos.y} r={radius + 9} fill={color} opacity={0.16} /> : null}
                  <circle cx={pos.x} cy={pos.y} r={radius} fill={color} opacity={isFocus ? 1 : 0.85} />
                  <text
                    x={pos.x}
                    y={pos.y - radius - 7}
                    textAnchor="middle"
                    className={cn('text-[9px]', isFocus ? 'fill-white' : 'fill-[rgba(233,237,246,0.55)]')}
                  >
                    {node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title}
                  </text>
                </motion.g>
              );
            })}
          </svg>
        </div>

        {selectedNode ? (
          <div className="mt-3 rounded-xl border border-line bg-surface-2/50 p-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[selectedNode.type] ?? '#6E9BFF' }} />
              <span className="label">{selectedNode.type}</span>
              <span className="ml-auto font-mono text-2xs text-ink-faint">
                confidence {(selectedNode.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <p className="mt-2 text-[14px] font-medium text-ink">{selectedNode.title}</p>
            <p className="mt-2 text-2xs text-ink-faint">
              {edges.filter((e) => e.fromId === selectedNode.id || e.toId === selectedNode.id).length} relationship(s) ·
              every edge below was created from ingested content or explicit user action
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {edges
                .filter((e) => e.fromId === selectedNode.id || e.toId === selectedNode.id)
                .slice(0, 12)
                .map((edge) => {
                  const otherId = edge.fromId === selectedNode.id ? edge.toId : edge.fromId;
                  const other = nodes.find((n) => n.id === otherId);
                  return (
                    <Badge key={edge.id} variant="violet">
                      {edge.type.replace('_', ' ').toLowerCase()} → {other?.title ?? otherId.slice(0, 8)}
                    </Badge>
                  );
                })}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-center text-2xs text-ink-faint">
            {nodes.length} entities · {edges.length} relationships · hover to trace connections, click to inspect
          </p>
        )}
      </CardContent>
    </Card>
  );
}
