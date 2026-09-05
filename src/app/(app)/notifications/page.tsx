"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, ShieldCheck, AlertTriangle, Brain, CalendarClock, FolderKanban, Puzzle } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { cn, relativeTime } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  APPROVAL_REQUIRED: ShieldCheck,
  RUN_COMPLETED: CheckCheck,
  RUN_FAILED: AlertTriangle,
  DEADLINE_APPROACHING: CalendarClock,
  PROJECT_AT_RISK: FolderKanban,
  INTEGRATION_ERROR: Puzzle,
  MEMORY_SAVED: Brain,
  WORKFLOW_COMPLETED: Bell,
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      api.get<{
        notifications: Array<{ id: string; kind: string; title: string; body: string; href: string | null; read: boolean; createdAt: string }>;
        unread: number;
      }>("/api/notifications"),
    refetchInterval: 20_000,
  });

  async function markAll() {
    await api.patch("/api/notifications", { markAllRead: true });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function markOne(id: string) {
    await api.patch("/api/notifications", { id });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-8 md:px-8">
      <PageHeader
        title="Notifications"
        description="Approval requests, run outcomes, deadlines, project risk and integration errors."
        actions={
          data?.unread ? (
            <Button variant="secondary" size="md" onClick={markAll}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read ({data.unread})
            </Button>
          ) : undefined
        }
      />

      <div className="mt-6 space-y-2">
        {isLoading ? (
          <LoadingRows rows={4} />
        ) : data?.notifications?.length ? (
          data.notifications.map((notification) => {
            const Icon = ICONS[notification.kind] ?? Bell;
            const content = (
              <div
                className={cn(
                  "flex items-start gap-3 rounded-[12px] border px-4 py-3 transition-colors",
                  notification.read ? "border-line bg-surface-1" : "border-accent/25 bg-accent/[0.05] hover:border-accent/40",
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", notification.read ? "text-mute" : "text-accent-bright")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-ink">{notification.title}</p>
                    {!notification.read ? <Badge tone="accent">New</Badge> : null}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-dim">{notification.body}</p>
                  <p className="mt-1.5 text-[11px] text-mute">{relativeTime(notification.createdAt)}</p>
                </div>
                {!notification.read ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      event.preventDefault();
                      void markOne(notification.id);
                    }}
                  >
                    Mark read
                  </Button>
                ) : null}
              </div>
            );

            return (
              <div key={notification.id}>
                {notification.href ? (
                  <Link href={notification.href} className="block">
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </div>
            );
          })
        ) : (
          <Card>
            <EmptyState icon={Bell} title="No notifications" description="You will see approval requests, run results and risk signals here." />
          </Card>
        )}
      </div>
    </div>
  );
}
