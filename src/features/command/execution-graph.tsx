'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Check, Loader2, PauseCircle, ShieldAlert, X } from 'lucide-react';

export type GraphNodeState = 'IDLE' | 'QUEUED' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface GraphNode {
  id: string;
  label: string;
  sublabel?: string;
  state: GraphNodeState;
}

export interface GraphEdge {
  from: string;
  to: string;
}

/** Fixed layout: a dependency DAG rendered top-to-bottom with parallel branches. */
const LAYOUT: Record<string, { x: number; y: number }> = {
  intent: { x: 50, y: 4 },
  context: { x: 50, y: 16 },
  planning: { x: 50, y: 30 },
  research: { x: 25, y: 46 },
  knowledge: { x: 75, y: 46 },
  analyst: { x: 16, y: 62 },
  creative: { x: 84, y: 62 },
  execution: { x: 50, y: 62 },
  approval: { x: 50, y: 78 },
  review: { x: 50, y: 90 },
  validation: { x: 30, y: 96 },
  result: { x: 70, y: 96 },
};

const STATE_STYLE: Record<GraphNodeState, { ring: string; text: string; bg: string; dot: string }> = {
  IDLE: { ring: 'border-line bg-surface-2/60', text: 'text-ink-faint', bg: 'bg-surface-2/60', dot: 'bg-white/20' },
  QUEUED: { ring: 'border-line-strong bg-surface-2/80', text: 'text-ink-muted', bg: 'bg-surface-2/80', dot: 'bg-ink-faint' },
  RUNNING: { ring: 'border-accent/60 bg-accent/10 shadow-[0_0_22px_-6px_rgba(61,126,255,0.85)]', text: 'text-ink', bg: 'bg-accent/10', dot: 'bg-accent' },
  WAITING: { ring: 'border-warn/55 bg-warn/10 shadow-[0_0_20px_-8px_rgba(245,181,68,0.8)]', text: 'text-ink', bg: 'bg-warn/10', dot: 'bg-warn' },
  COMPLETED: { ring: 'border-good/45 bg-good/10', text: 'text-ink', bg: 'bg-good/10', dot: 'bg-good' },
  FAILED: { ring: 'border-bad/55 bg-bad/10', text: 'text-ink', bg: 'bg-bad/10', dot: 'bg-bad' },
  SKIPPED: { ring: 'border-line bg-surface-2/40', text: 'text-ink-faint', bg: 'bg-surface-2/40', dot: 'bg-white/10' },
};

export function ExecutionGraph({
  nodes,
  edges,
  height = 460,
  compact,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  height?: number;
  compact?: boolean;
}) {
  const byId = React.useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const visible = nodes.filter((n) => LAYOUT[n.id]);
  const visibleEdges = edges.filter((e) => LAYOUT[e.from] && LAYOUT[e.to] && byId.has(e.from) && byId.has(e.to));

  return (
    <div className="relative w-full" style={{ height }}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {visibleEdges.map((edge) => {
          const a = LAYOUT[edge.from]!;
          const b = LAYOUT[edge.to]!;
          const source = byId.get(edge.from)!;
          const target = byId.get(edge.to)!;
          const active = source.state === 'COMPLETED' && (target.state === 'RUNNING' || target.state === 'WAITING');
          const done = source.state === 'COMPLETED' && target.state === 'COMPLETED';
          const failed = source.state === 'FAILED' || target.state === 'FAILED';

          const midY = (a.y + b.y) / 2;
          const d = `M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`;

          return (
            <g key={`${edge.from}-${edge.to}`}>
              <path
                d={d}
                fill="none"
                stroke={failed ? 'rgba(255,92,108,0.45)' : done ? 'rgba(56,211,159,0.35)' : active ? 'rgba(61,126,255,0.55)' : 'rgba(255,255,255,0.08)'}
                strokeWidth={active ? 0.5 : 0.35}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
              {active ? (
                <path
                  d={d}
                  fill="none"
                  stroke="rgba(61,126,255,0.95)"
                  strokeWidth={0.5}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="2 3"
                  className="animate-flow-dash"
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      {visible.map((node) => {
        const pos = LAYOUT[node.id]!;
        const style = STATE_STYLE[node.state];
        return (
          <motion.div
            key={node.id}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            <div
              className={cn(
                'relative flex items-center gap-2 rounded-lg border px-2.5 py-1.5 backdrop-blur-md transition-all duration-300',
                style.ring,
                compact && 'px-2 py-1',
              )}
            >
              {node.state === 'RUNNING' ? (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className={cn('absolute inset-0 rounded-full animate-pulse-ring', style.dot)} />
                  <span className={cn('relative h-2 w-2 rounded-full', style.dot)} />
                </span>
              ) : node.state === 'WAITING' ? (
                <ShieldAlert className="h-3 w-3 shrink-0 text-warn" />
              ) : node.state === 'COMPLETED' ? (
                <Check className="h-3 w-3 shrink-0 text-good" />
              ) : node.state === 'FAILED' ? (
                <X className="h-3 w-3 shrink-0 text-bad" />
              ) : node.state === 'QUEUED' ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-ink-faint" />
              ) : node.state === 'SKIPPED' ? (
                <PauseCircle className="h-3 w-3 shrink-0 text-ink-faint" />
              ) : (
                <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} />
              )}

              <span className={cn('whitespace-nowrap text-[11px] font-medium tracking-tight', style.text, compact && 'text-[10px]')}>
                {node.label}
              </span>
            </div>
            {node.sublabel ? (
              <p className="mt-1 max-w-[150px] truncate text-center text-[10px] text-ink-faint">{node.sublabel}</p>
            ) : null}
          </motion.div>
        );
      })}
    </div>
  );
}
