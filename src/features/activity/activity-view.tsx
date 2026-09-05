'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity as ActivityIcon, AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { fetchJson } from '@/hooks/use-session';
import { cn, relativeTime } from '@/lib/utils';

interface ActivityItem {
  id: string;
  type: string;
  action: string;
  summary: string;
  severity: string;
  status: string;
  entityType: string | null;
  entityId: string | null;
  intentId: string | null;
  projectId: string | null;
  createdAt: string;
  project: { id: string; name: string } | null;
  user: { id: string; name: string } | null;
}

const FILTERS = ['ALL', 'AGENT', 'TOOL', 'PROJECT', 'TASK', 'DOCUMENT', 'WORKFLOW', 'APPROVAL', 'MEMORY', 'INTEGRATION', 'ERROR'] as const;

const SEVERITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  SUCCESS: CheckCircle2,
  INFO: Info,
  WARNING: AlertTriangle,
  ERROR: XCircle,
};

const SEVERITY_TEXT: Record<string, string> = {
  SUCCESS: 'text-good',
  INFO: 'text-ink-muted',
  WARNING: 'text-warn',
  ERROR: 'text-bad',
};

export function ActivityView() {
  const [filter, setFilter] = React.useState<string>('ALL');
  const { data, isLoading } = useQuery({
    queryKey: ['activity', filter],
    queryFn: () => fetchJson<{ items: ActivityItem[]; counts: Record<string, number> }>(`/api/activity?type=${filter}&limit=150`),
    refetchInterval: 20_000,
  });

  // Group by day
  const groups = React.useMemo(() => {
    const out: { day: string; items: ActivityItem[] }[] = [];
    for (const item of data?.items ?? []) {
      const day = new Date(item.createdAt).toDateString();
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [data]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <header>
        <p className="label">Activity</p>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">System activity</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          Every agent run, tool call, approval decision and memory write is recorded here. Nothing in this list is
          simulated — each row was persisted by an executed code path.
        </p>
      </header>

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
            {entry !== 'ALL' && data?.counts[entry] ? <span className="ml-1.5 text-2xs text-ink-faint">{data.counts[entry]}</span> : null}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : groups.length ? (
        <div className="space-y-5">
          {groups.map((group, gi) => (
            <motion.div
              key={group.day}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(gi * 0.05, 0.2) }}
            >
              <p className="label mb-2 px-1">
                {new Date(group.day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              </p>
              <Card className="overflow-hidden">
                <CardContent className="divide-y divide-line-faint p-0">
                  {group.items.map((item) => {
                    const Icon = SEVERITY_ICON[item.severity] ?? Info;
                    return (
                      <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                        <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', SEVERITY_TEXT[item.severity])} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-medium text-ink">{item.action}</span>
                            <Badge variant="outline">{item.type.toLowerCase()}</Badge>
                            {item.project ? (
                              <Link href={`/projects/${item.project.id}`} className="text-2xs text-accent-soft hover:underline">
                                {item.project.name}
                              </Link>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{item.summary}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-2xs text-ink-faint">{relativeTime(item.createdAt)}</span>
                          {item.intentId ? (
                            <Link href={`/runs/${item.intentId}`} className="text-2xs text-accent-soft hover:underline">
                              View run
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ActivityIcon}
          title="No activity yet"
          description="Run a command from Command Center and this timeline fills with real, persisted events."
          action={
            <Link href="/command">
              <Badge variant="accent">Open Command Center</Badge>
            </Link>
          }
        />
      )}
    </div>
  );
}
