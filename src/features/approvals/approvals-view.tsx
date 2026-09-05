'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { ApprovalCard, type ApprovalRecord } from '@/features/approvals/approval-card';
import { fetchJson } from '@/hooks/use-session';
import { cn, relativeTime } from '@/lib/utils';

interface ApprovalRow extends ApprovalRecord {
  decisionNote: string | null;
  decidedAt: string | null;
  intent: { id: string; objective: string; rawInput: string } | null;
  run: { id: string; agent: { name: string; key: string } } | null;
  project: { id: string; name: string } | null;
}

const FILTERS = ['PENDING', 'APPROVED', 'DENIED', 'ALL'] as const;

export function ApprovalsView() {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<string>('PENDING');

  const { data, isLoading } = useQuery({
    queryKey: ['approvals', filter],
    queryFn: () => fetchJson<{ items: ApprovalRow[]; pending: number }>(`/api/approvals?status=${filter === 'ALL' ? '' : filter}`),
    refetchInterval: 15_000,
  });

  const pending = data?.items.filter((i) => i.status === 'PENDING') ?? [];
  const decided = data?.items.filter((i) => i.status !== 'PENDING') ?? [];

  return (
    <div className="mx-auto max-w-[1000px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Approvals</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">Approval center</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Sensitive actions (WRITE, EXTERNAL_ACTION, HIGH_IMPACT) pause here until you decide. You can modify the
            arguments before approving. Nothing executes before your decision.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((entry) => (
            <button
              key={entry}
              onClick={() => setFilter(entry)}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors',
                filter === entry ? 'border-accent/40 bg-accent/10 text-ink' : 'border-line bg-surface-2/40 text-ink-muted hover:bg-surface-3/50',
              )}
            >
              {entry.charAt(0) + entry.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : (
        <>
          {pending.length ? (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <ShieldCheck className="h-4 w-4 text-warn" /> Awaiting your decision
                <Badge variant="warn">{pending.length}</Badge>
              </h2>
              {pending.map((approval) => (
                <div key={approval.id} className="space-y-2">
                  <ApprovalCard approval={approval} onDecided={() => void qc.invalidateQueries({ queryKey: ['approvals'] })} />
                  <div className="flex flex-wrap items-center gap-2 px-1 text-2xs text-ink-faint">
                    {approval.intent ? (
                      <Link href={`/runs/${approval.intent.id}`} className="text-accent-soft hover:underline">
                        {approval.intent.objective}
                      </Link>
                    ) : null}
                    {approval.run ? <span>· {approval.run.agent.name}</span> : null}
                    {approval.project ? <span>· {approval.project.name}</span> : null}
                    <span>· requested {relativeTime(approval.createdAt)}</span>
                  </div>
                </div>
              ))}
            </section>
          ) : filter === 'PENDING' ? (
            <EmptyState
              icon={ShieldCheck}
              title="Nothing to approve"
              description="When a run reaches a sensitive action, it stops and appears here."
            />
          ) : null}

          {decided.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px]">Decided</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: ['approvals'] })}>
                  Refresh
                </Button>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {decided.map((item) => (
                  <Link
                    key={item.id}
                    href={`/runs/${item.intent?.id ?? ''}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
                  >
                    <Badge variant={item.status === 'APPROVED' ? 'good' : item.status === 'DENIED' ? 'bad' : 'default'}>
                      {item.status}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.title}</span>
                    <span className="shrink-0 font-mono text-2xs text-ink-faint">{item.toolKey}</span>
                    <span className="shrink-0 text-2xs text-ink-faint">{relativeTime(item.decidedAt ?? item.createdAt)}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
