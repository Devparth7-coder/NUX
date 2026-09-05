"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bot, Cpu, Gauge, Coins } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { LoadingRows } from "@/components/ui/skeleton";
import { cn, formatDuration, titleCase } from "@/lib/utils";
import type { AgentSummary } from "@/types/api";

const ACCENT: Record<string, string> = {
  planning: "#60A5FA",
  research: "#818CF8",
  knowledge: "#34D399",
  execution: "#F59E0B",
  review: "#F472B6",
  creative: "#C084FC",
  analyst: "#22D3EE",
};

export default function AgentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<{ agents: AgentSummary[] }>("/api/agents"),
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-8 md:px-8">
      <PageHeader
        title="Agents"
        description="Seven specialised agents. Each declares capabilities, allowed tools and a permission ceiling; the orchestrator selects them from the intent."
      />

      {isLoading ? (
        <div className="mt-6">
          <LoadingRows rows={5} />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(data?.agents ?? []).map((agent) => {
            const accent = ACCENT[agent.key] ?? "#64748B";
            return (
              <Link key={agent.id} href={`/agents/${agent.id}`}>
                <Card className="h-full transition-colors hover:border-line-strong">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border text-[11px] font-semibold"
                        style={{ borderColor: `${accent}55`, background: `${accent}18`, color: accent }}
                      >
                        {agent.key.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-[13.5px] font-medium text-ink">{agent.name}</h3>
                          <Badge tone={agent.status === "ACTIVE" ? "success" : "neutral"} className="ml-auto">
                            {titleCase(agent.status)}
                          </Badge>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-mute">{agent.description}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {agent.capabilities.slice(0, 4).map((capability) => (
                        <span key={capability} className="rounded-md border border-line bg-surface-1 px-1.5 py-0.5 text-[10px] text-mute">
                          {capability.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
                      <Metric icon={Cpu} label="Runs" value={String(agent.totalRuns)} />
                      <Metric
                        icon={Gauge}
                        label="Avg"
                        value={agent.avgLatencyMs ? formatDuration(agent.avgLatencyMs) : "—"}
                      />
                      <Metric
                        icon={Coins}
                        label="Success"
                        value={agent.successRate !== null ? `${Math.round(agent.successRate * 100)}%` : "—"}
                      />
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <Badge tone={STATUS_TONE[agent.permissionLevel] ?? "neutral"}>
                        {agent.permissionLevel.replace("_", " ")}
                      </Badge>
                      <span className="text-[10.5px] text-mute">{agent.allowedTools.length} tools</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-[0.08em] text-mute">
        <Icon className="h-2.5 w-2.5" /> {label}
      </div>
      <p className={cn("mt-0.5 text-[12px] font-medium text-ink")}>{value}</p>
    </div>
  );
}
