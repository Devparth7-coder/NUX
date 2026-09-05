"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Coins,
  Cpu,
  FileText,
  Gauge,
  RotateCcw,
  Square,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, clockTime, formatDuration, relativeTime, titleCase } from "@/lib/utils";
import { useLiveRun } from "@/hooks/use-live-run";
import { ExecutionGraph } from "@/features/command/execution-graph";
import { ApprovalCard } from "@/features/command/approval-card";
import { ResultPanel } from "@/features/command/result-panel";
import type { RunEventSummary, RunResult } from "@/types/api";

type RunDetail = {
  run: {
    id: string;
    key: string;
    name: string;
    status: string;
    step: string | null;
    progress: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    latencyMs: number | null;
    error: string | null;
    errorDetail: unknown;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    outputs: Record<string, unknown> | null;
    intent: { id: string; rawInput: string; objective: string; deadlineText: string | null } | null;
    project: { id: string; name: string } | null;
    children: Array<{
      id: string;
      key: string;
      name: string;
      status: string;
      latencyMs: number | null;
      tokensIn: number;
      tokensOut: number;
      outputs: Record<string, unknown> | null;
      error: string | null;
      createdAt: string;
    }>;
    approvals: Array<{ id: string; title: string; status: string; permissionLevel: string; toolKey: string; whatHappens: string; whyNeeded: string; affectedData: Record<string, unknown>; createdAt: string }>;
    artifacts: Array<{ id: string; title: string; type: string }>;
    modelCalls: Array<{ id: string; purpose: string; model: string; provider: string; tokensIn: number; tokensOut: number; latencyMs: number; status: string; simulated: boolean }>;
  };
  timeline: RunEventSummary[];
  executions: Array<{
    id: string;
    toolKey: string;
    status: string;
    input: Record<string, unknown>;
    output: Record<string, unknown> | null;
    error: string | null;
    durationMs: number | null;
    permissionLevel: string;
    createdAt: string;
  }>;
};

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.get<RunDetail>(`/api/agent-runs/${id}`),
    refetchInterval: (query) => {
      const status = (query.state.data as RunDetail | undefined)?.run?.status;
      if (!status) return 2000;
      return ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"].includes(status) ? false : 2000;
    },
  });

  const { events, connected } = useLiveRun({ runId: id, enabled: Boolean(data) });

  const terminal = data ? ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"].includes(data.run.status) : false;

  const timeline = React.useMemo(() => {
    const persisted = (data?.timeline ?? []).map((e) => ({ id: e.id, at: e.at, kind: e.kind, message: e.message }));
    const live = events.map((e) => ({ id: e.id, at: e.at, kind: e.type, message: e.message }));
    const merged = new Map(persisted.concat(live).map((e) => [e.id, e]));
    return [...merged.values()].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [data, events]);

  async function act(action: "cancel" | "retry") {
    await api.post(`/api/agent-runs/${id}/${action}`);
    toast({ tone: action === "cancel" ? "warning" : "info", title: action === "cancel" ? "Run cancelled" : "Retry queued" });
    void queryClient.invalidateQueries({ queryKey: ["run", id] });
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1180px] px-5 py-8 md:px-8">
        <LoadingRows rows={6} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-[1180px] px-5 py-8 md:px-8">
        <Card>
          <ErrorState
            title="Run not found"
            description={error instanceof Error ? error.message : undefined}
            action={
              <Link href="/activity">
                <Button variant="secondary" size="sm">
                  Back to activity
                </Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const { run } = data;
  const result = (run.outputs as { result?: RunResult } | null)?.result ?? null;
  const graph = (run.outputs as { plan?: { steps?: Array<{ id: string; agent: string; title: string; dependsOn: string[] }> } } | null)?.plan;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-8 md:px-8">
      <Link href="/activity" className="inline-flex items-center gap-1.5 text-[11.5px] text-mute hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Activity
      </Link>

      <PageHeader
        className="mt-3"
        title={run.intent?.rawInput ?? run.name}
        description={run.intent ? `${titleCase(run.intent.objective)}${run.intent.deadlineText ? ` · ${run.intent.deadlineText}` : ""}` : undefined}
        actions={
          <>
            {!terminal ? (
              <Button variant="ghost" size="md" onClick={() => void act("cancel")}>
                <Square className="h-3.5 w-3.5" /> Cancel
              </Button>
            ) : (
              <Button variant="secondary" size="md" onClick={() => void act("retry")}>
                <RotateCcw className="h-3.5 w-3.5" /> Retry failed steps
              </Button>
            )}
            <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{titleCase(run.status)}</Badge>
          </>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat icon={Cpu} label="Agents" value={String(run.children.length)} />
        <Stat icon={Wrench} label="Tool calls" value={String(data.executions.length)} />
        <Stat icon={Gauge} label="Duration" value={formatDuration(run.latencyMs)} />
        <Stat icon={Coins} label="Tokens" value={`${run.tokensIn + run.tokensOut}`} />
      </div>

      {!terminal ? <Progress value={run.progress} className="mt-4" /> : null}

      {run.error ? (
        <Card className="mt-5 border-red/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red">
              <AlertTriangle className="h-4 w-4" /> What failed
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <p className="text-[12.5px] text-dim">{run.error}</p>
            {run.errorDetail ? (
              <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface-1 p-3 font-mono text-[11px] text-mute">
                {JSON.stringify(run.errorDetail, null, 2)}
              </pre>
            ) : null}
            <p className="mt-2 text-[11.5px] text-mute">
              Completed steps were preserved. Retrying re-runs only the failed or skipped steps.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {run.approvals.length ? (
        <section className="mt-5 space-y-3">
          <h3 className="text-[13px] font-semibold text-ink">Approvals</h3>
          {run.approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval as never}
              onResolved={() => void queryClient.invalidateQueries({ queryKey: ["run", id] })}
            />
          ))}
        </section>
      ) : null}

      {result ? (
        <div className="mt-5">
          <ResultPanel result={result} intentId={run.intent?.id ?? run.id} runId={run.id} />
        </div>
      ) : null}

      <Tabs defaultValue="timeline" className="mt-6">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="tools">Tool calls</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="models">Model calls</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="mt-4">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle>Execution timeline</CardTitle>
                <p className="text-[11.5px] text-mute mt-1">
                  {connected ? "Streaming live" : terminal ? "Final state" : "Polling"} · {timeline.length} event(s)
                </p>
              </div>
              {connected ? (
                <Badge tone="accent">
                  <Activity className="h-3 w-3" /> Live
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent className="max-h-[520px] overflow-y-auto pt-3">
              <ol className="space-y-2">
                {timeline.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span className="mt-[3px] font-mono text-[10.5px] text-mute/80">{clockTime(event.at)}</span>
                    <span
                      className={cn(
                        "mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full",
                        event.kind.includes("FAILED") || event.kind === "ERROR"
                          ? "bg-red"
                          : event.kind.includes("APPROVAL")
                            ? "bg-amber"
                            : event.kind.includes("COMPLETED") || event.kind === "RESULT_READY"
                              ? "bg-emerald"
                              : "bg-accent",
                      )}
                    />
                    <span className="text-[12px] leading-relaxed text-dim">{event.message}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="graph" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Execution graph</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {graph?.steps?.length ? (
                <ExecutionGraph
                  nodes={graph.steps.map((s) => ({ ...s, status: "PENDING" }))}
                  runs={run.children as never}
                />
              ) : (
                <p className="py-8 text-center text-[12px] text-mute">No graph recorded for this run.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Tool executions</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {data.executions.length ? (
                <ul className="space-y-2">
                  {data.executions.map((execution) => (
                    <li key={execution.id} className="rounded-[10px] border border-line bg-surface-1 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Wrench className="h-3.5 w-3.5 text-mute" />
                        <code className="font-mono text-[12px] text-ink">{execution.toolKey}</code>
                        <Badge tone={STATUS_TONE[execution.status] ?? "neutral"}>{titleCase(execution.status)}</Badge>
                        <Badge tone={execution.permissionLevel === "WRITE" ? "accent" : "neutral"}>{execution.permissionLevel}</Badge>
                        <span className="ml-auto text-[11px] text-mute">{formatDuration(execution.durationMs)}</span>
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-2 font-mono text-[10.5px] text-dim">
                          {JSON.stringify(execution.input, null, 2)}
                        </pre>
                        <pre
                          className={cn(
                            "overflow-x-auto rounded-lg border border-line bg-surface-2 p-2 font-mono text-[10.5px]",
                            execution.error ? "text-red/90" : "text-dim",
                          )}
                        >
                          {execution.error ?? JSON.stringify(execution.output, null, 2) ?? "—"}
                        </pre>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-8 text-center text-[12px] text-mute">No tool calls in this run.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Agent runs</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {run.children.length ? (
                <ul className="space-y-2">
                  {run.children.map((child) => (
                    <li key={child.id} className="rounded-[10px] border border-line bg-surface-1 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12.5px] text-ink">{child.name}</span>
                        <Badge tone={STATUS_TONE[child.status] ?? "neutral"}>{titleCase(child.status)}</Badge>
                        <span className="ml-auto text-[11px] text-mute">{formatDuration(child.latencyMs)}</span>
                        <span className="text-[11px] text-mute">{relativeTime(child.createdAt)}</span>
                      </div>
                      {child.error ? <p className="mt-2 text-[11.5px] text-red">{child.error}</p> : null}
                      {child.outputs ? (
                        <pre className="mt-2 max-h-52 overflow-auto rounded-lg border border-line bg-surface-2 p-2 font-mono text-[10.5px] text-dim">
                          {JSON.stringify(child.outputs, null, 2)}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-8 text-center text-[12px] text-mute">No child agent runs.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="models" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Model calls</CardTitle>
              <p className="text-[11.5px] text-mute mt-1">
                Token usage, latency and provider for every model invocation in this run.
              </p>
            </CardHeader>
            <CardContent className="pt-3">
              {run.modelCalls.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="border-b border-line text-left text-mute">
                        <th className="py-2 pr-3 font-medium">Purpose</th>
                        <th className="py-2 pr-3 font-medium">Provider</th>
                        <th className="py-2 pr-3 font-medium">Model</th>
                        <th className="py-2 pr-3 text-right font-medium">In</th>
                        <th className="py-2 pr-3 text-right font-medium">Out</th>
                        <th className="py-2 pr-3 text-right font-medium">Latency</th>
                        <th className="py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.modelCalls.map((call) => (
                        <tr key={call.id} className="border-b border-line/60">
                          <td className="py-2 pr-3 text-dim">{call.purpose}</td>
                          <td className="py-2 pr-3 text-mute">{call.provider}</td>
                          <td className="py-2 pr-3 font-mono text-[10.5px] text-mute">{call.model}</td>
                          <td className="py-2 pr-3 text-right text-dim">{call.tokensIn}</td>
                          <td className="py-2 pr-3 text-right text-dim">{call.tokensOut}</td>
                          <td className="py-2 pr-3 text-right text-mute">{formatDuration(call.latencyMs)}</td>
                          <td className="py-2">
                            <Badge tone={call.status === "ok" ? "success" : call.status === "fallback" ? "warning" : "danger"}>
                              {call.simulated ? "simulated" : call.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-8 text-center text-[12px] text-mute">No model calls recorded.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {run.artifacts.length ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <ul className="space-y-2">
              {run.artifacts.map((artifact) => (
                <li key={artifact.id} className="flex items-center gap-3 rounded-[10px] border border-line bg-surface-1 px-3 py-2.5">
                  <FileText className="h-3.5 w-3.5 text-mute" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{artifact.title}</span>
                  <Badge tone="neutral">{titleCase(artifact.type)}</Badge>
                  <a href={`/api/artifacts/${artifact.id}/download`} download className="text-[11.5px] text-accent-bright hover:underline">
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="panel flex items-center gap-3 px-4 py-3">
      <Icon className="h-3.5 w-3.5 text-mute" />
      <div>
        <p className="text-[10.5px] uppercase tracking-[0.12em] text-mute">{label}</p>
        <p className="text-[15px] font-semibold text-ink">{value}</p>
      </div>
    </div>
  );
}
