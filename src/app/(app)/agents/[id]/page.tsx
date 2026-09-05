"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bot, Wrench, ShieldCheck, Activity as ActivityIcon } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { cn, formatDuration, relativeTime, titleCase } from "@/lib/utils";

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["agent", params.id],
    queryFn: () =>
      api.get<{
        agent: {
          id: string;
          key: string;
          name: string;
          description: string;
          systemPrompt: string;
          capabilities: string[];
          allowedTools: string[];
          permissionLevel: string;
          model: string;
          temperature: number;
          status: string;
          totalRuns: number;
          totalTokens: number;
          totalCostUsd: number;
          runs: Array<{ id: string; status: string; latencyMs: number | null; tokensIn: number; tokensOut: number; createdAt: string; intentId: string | null }>;
        };
        stats: { runs: number; succeeded: number; failed: number; successRate: number | null; avgLatencyMs: number | null };
      }>(`/api/agents/${params.id}`),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-5 py-8 md:px-8">
        <LoadingRows rows={5} />
      </div>
    );
  }
  if (!data) return null;

  const { agent, stats } = data;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-8 md:px-8">
      <PageHeader
        title={agent.name}
        description={agent.description}
        actions={
          <Badge tone={STATUS_TONE[agent.permissionLevel] ?? "neutral"}>{agent.permissionLevel.replace("_", " ")} ceiling</Badge>
        }
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Runs" value={String(stats.runs)} />
        <Stat label="Success rate" value={stats.successRate !== null ? `${Math.round(stats.successRate * 100)}%` : "—"} />
        <Stat label="Avg latency" value={stats.avgLatencyMs ? formatDuration(stats.avgLatencyMs) : "—"} />
        <Stat label="Tokens" value={agent.totalTokens.toLocaleString()} />
      </div>

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="runs">Run history</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-3 text-[12px]">
              <Row label="Key" value={<code className="font-mono text-[11.5px] text-dim">{agent.key}</code>} />
              <Row label="Model" value={<span className="text-dim">{agent.model}</span>} />
              <Row label="Temperature" value={<span className="text-dim">{agent.temperature}</span>} />
              <Row label="Status" value={<Badge tone={agent.status === "ACTIVE" ? "success" : "neutral"}>{titleCase(agent.status)}</Badge>} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Capabilities</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="flex flex-wrap gap-1.5">
                {agent.capabilities.map((capability) => (
                  <span key={capability} className="rounded-md border border-line bg-surface-1 px-2 py-1 text-[11px] text-dim">
                    {capability.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>System configuration</CardTitle>
              <p className="text-[11.5px] text-mute mt-1">The instruction set this agent runs with.</p>
            </CardHeader>
            <CardContent className="pt-3">
              <pre className="whitespace-pre-wrap rounded-[10px] border border-line bg-surface-1 p-3 font-mono text-[11.5px] leading-relaxed text-dim">
                {agent.systemPrompt}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Allowed tools</CardTitle>
              <p className="text-[11.5px] text-mute mt-1">The orchestrator refuses any tool outside this list.</p>
            </CardHeader>
            <CardContent className="pt-3">
              <ul className="space-y-1.5">
                {agent.allowedTools.map((tool) => (
                  <li key={tool} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface-1 px-3 py-2">
                    <Wrench className="h-3.5 w-3.5 text-mute" />
                    <code className="font-mono text-[12px] text-dim">{tool}</code>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Run history</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {agent.runs.length ? (
                <ul className="space-y-1.5">
                  {agent.runs.map((run) => (
                    <li key={run.id} className="flex items-center gap-3 rounded-[10px] border border-line bg-surface-1 px-3 py-2">
                      <ActivityIcon className="h-3.5 w-3.5 text-mute" />
                      <Link href={`/runs/${run.id}`} className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-dim hover:text-ink">
                        {run.id}
                      </Link>
                      <span className="text-[11px] text-mute">{formatDuration(run.latencyMs)}</span>
                      <span className="text-[11px] text-mute">{relativeTime(run.createdAt)}</span>
                      <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{titleCase(run.status)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={Bot} title="No runs yet" description="This agent has not executed in this workspace." />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-[10.5px] uppercase tracking-[0.12em] text-mute">{label}</p>
      <p className="mt-1.5 text-[18px] font-semibold text-ink">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={cn("text-mute")}>{label}</span>
      {value}
    </div>
  );
}
