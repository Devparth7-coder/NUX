'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { cn, relativeTime } from '@/lib/utils';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  severity: string;
  read: boolean;
  actionUrl: string | null;
  createdAt: string;
}

const TONE: Record<string, 'default' | 'good' | 'warn' | 'bad' | 'accent'> = {
  APPROVAL_REQUIRED: 'warn',
  AGENT_FAILED: 'bad',
  AGENT_COMPLETED: 'good',
  WORKFLOW_COMPLETED: 'good',
  PROJECT_RISK: 'warn',
  DEADLINE: 'accent',
  MEMORY: 'accent',
  INTEGRATION_ERROR: 'bad',
};

export function NotificationsView() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchJson<{ items: NotificationRow[]; unread: number }>('/api/notifications'),
    refetchInterval: 20_000,
  });

  async function markAll() {
    await fetchJson('/api/notifications', { method: 'PATCH', body: JSON.stringify({ markAllRead: true }) });
    await qc.invalidateQueries({ queryKey: ['notifications'] });
    push({ title: 'All notifications marked read' });
  }

  return (
    <div className="mx-auto max-w-[860px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Notifications</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">Notifications</h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-muted">
            System events raised by executed code: approvals, completed or failed runs, risk changes and deadlines.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void markAll()} disabled={!data?.unread}>
          <CheckCheck className="h-4 w-4" /> Mark all read ({data?.unread ?? 0})
        </Button>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : data?.items.length ? (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px]">All notifications</CardTitle>
            <span className="text-2xs text-ink-faint">{data.items.length} total</span>
          </CardHeader>
          <CardContent className="divide-y divide-line-faint p-0">
            {data.items.map((item) => {
              const body = (
                <div className={cn('flex items-start gap-3 px-4 py-3', !item.read && 'bg-accent/[0.04]')}>
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', item.read ? 'bg-line-strong' : 'bg-accent')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-ink">{item.title}</span>
                      <Badge variant={TONE[item.type] ?? 'default'}>{item.type.replace(/_/g, ' ').toLowerCase()}</Badge>
                    </div>
                    {item.body ? <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{item.body}</p> : null}
                  </div>
                  <span className="shrink-0 text-2xs text-ink-faint">{relativeTime(item.createdAt)}</span>
                </div>
              );
              return item.actionUrl ? (
                <Link key={item.id} href={item.actionUrl} className="block transition-colors hover:bg-white/[0.03]">
                  {body}
                </Link>
              ) : (
                <div key={item.id}>{body}</div>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <EmptyState icon={Bell} title="No notifications" description="Notifications appear when the system needs your attention." />
      )}
    </div>
  );
}
