"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { cn, clockTime, relativeTime, titleCase } from "@/lib/utils";
import type { ActivitySummary } from "@/types/api";

const FILTERS = ["ALL", "AGENTS", "TOOLS", "PROJECTS", "DOCUMENTS", "WORKFLOWS", "APPROVALS", "ERRORS", "MEMORY", "INTEGRATION"];

export default function ActivityPage() {
  const [filter, setFilter] = React.useState("ALL");
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["activity", filter],
    queryFn: () => api.get<{ activity: ActivitySummary[]; total: number; counts: Array<{ kind: string; count: number }> }>(`/api/activity?kind=${filter}&pageSize=60`),
    refetchInterval: 15_000,
  });

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-8 md:px-8">
      <PageHeader
        title="Activity"
        description="Complete observability of agent executions, tool calls, project updates, ingestion, approvals, workflow runs and errors."
        actions={
          <Button variant="secondary" size="md" onClick={() => void refetch()} loading={isFetching}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap gap-1.5">
        {FILTERS.map((option) => {
          const count = data?.counts?.find((c) => c.kind === option)?.count;
          return (
            <button
              key={option}
              onClick={() => setFilter(option)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors",
                filter === option
                  ? "border-accent/40 bg-accent/10 text-[#9dc0ff]"
                  : "border-line bg-surface-1 text-mute hover:text-dim hover:border-line-strong",
              )}
            >
              {titleCase(option)}
              {option !== "ALL" && count !== undefined ? <span className="ml-1.5 text-mute/70">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Event stream</CardTitle>
          <p className="text-[11.5px] text-mute mt-1">{data?.total ?? 0} event(s)</p>
        </CardHeader>
        <CardContent className="pt-3">
          {isLoading ? (
            <LoadingRows rows={6} />
          ) : data?.activity?.length ? (
            <ol className="space-y-1.5">
              {data.activity.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    "flex items-start gap-3 rounded-[10px] border px-3 py-2.5",
                    item.status === "error"
                      ? "border-red/25 bg-red/[0.05]"
                      : item.status === "warning"
                        ? "border-amber/20 bg-amber/[0.04]"
                        : "border-line bg-surface-1",
                  )}
                >
                  <span className="mt-0.5 font-mono text-[10.5px] text-mute/80">{clockTime(item.createdAt)}</span>
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      item.status === "error"
                        ? "bg-red"
                        : item.status === "warning"
                          ? "bg-amber"
                          : item.status === "success"
                            ? "bg-emerald"
                            : "bg-mute",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-dim">{item.summary}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-mute">
                      <Badge tone="neutral">{titleCase(item.kind)}</Badge>
                      <span className="font-mono">{item.action}</span>
                      {item.user ? <span>{item.user.name}</span> : null}
                      {item.project ? (
                        <Link href={`/projects/${item.project.id}`} className="hover:text-ink">
                          {item.project.name}
                        </Link>
                      ) : null}
                      <span>{relativeTime(item.createdAt)}</span>
                    </div>
                    {item.status === "error" && item.detail ? (
                      <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface-2 p-2 font-mono text-[10.5px] text-red/90">
                        {JSON.stringify(item.detail, null, 2).slice(0, 400)}
                      </pre>
                    ) : null}
                  </div>
                  {item.status === "error" ? <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-red" /> : null}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={Activity} title="No activity" description="Nothing has happened in this workspace yet." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
