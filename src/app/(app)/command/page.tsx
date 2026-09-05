"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Sparkles,
  Clock,
  Brain,
  FolderKanban,
  Activity,
  Square,
  RotateCcw,
  Loader2,
  Radio,
  Search,
  Check,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn, clockTime, relativeTime, titleCase, truncate } from "@/lib/utils";
import { useLiveRun } from "@/hooks/use-live-run";
import { ExecutionGraph, type GraphNode } from "@/features/command/execution-graph";
import { ApprovalCard } from "@/features/command/approval-card";
import { ResultPanel } from "@/features/command/result-panel";
import type { IntentState, RunResult, ProjectSummary, TaskSummary } from "@/types/api";

const SUGGESTIONS = [
  "Prepare my NEXUS launch for this week.",
  "Analyze this research paper.",
  "Find everything related to Project Atlas.",
  "Review my unfinished tasks.",
  "Research competitors and summarize the opportunities.",
  "Prepare a presentation from these documents.",
];

type Started = {
  intentId: string;
  runId: string;
  graph: Array<{ id: string; agent: string; title: string; dependsOn: string[] }>;
  context: { items: number; confidence: number; sources: Array<{ label: string; count: number }> };
  rawInput: string;
};

export default function CommandPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [input, setInput] = React.useState("");
  const [started, setStarted] = React.useState<Started | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ projects: ProjectSummary[] }>("/api/projects?pageSize=6"),
  });
  const { data: tasks } = useQuery({
    queryKey: ["tasks", "recent"],
    queryFn: () => api.get<{ tasks: TaskSummary[]; summary: { overdue: number; blocked: number } }>("/api/tasks?pageSize=6"),
  });
  const { data: health } = useQuery({
    queryKey: ["system-health"],
    queryFn: () => api.get<{ ai: { demoMode: boolean; label: string } }>("/api/system/health"),
    staleTime: 60_000,
  });

  const { data: memory } = useQuery({
    queryKey: ["memory", "top"],
    queryFn: () => api.get<{ memories: Array<{ id: string; content: string; type: string; importance: number }> }>("/api/memory"),
  });
  const { data: recent } = useQuery({
    queryKey: ["intents"],
    queryFn: () => api.get<{ intents: Array<{ id: string; rawInput: string; objective: string; status: string; createdAt: string; runs: Array<{ id: string; status: string }> }> }>("/api/intents"),
    refetchInterval: 15_000,
  });

  const { data: state, isLoading } = useQuery({
    queryKey: ["intent", started?.intentId],
    queryFn: () => api.get<IntentState>(`/api/intents/${started!.intentId}`),
    enabled: Boolean(started),
    refetchInterval: (query) => {
      const data = query.state.data as IntentState | undefined;
      const status = data?.runs?.[0]?.status;
      if (!status) return 1500;
      return ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"].includes(status) ? false : 2000;
    },
  });

  const { events, connected } = useLiveRun({
    runId: started?.runId,
    intentId: started?.intentId,
    enabled: Boolean(started),
  });

  const orchestrator = state?.runs?.[0];
  const terminal = orchestrator
    ? ["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"].includes(orchestrator.status)
    : false;

  async function submit(rawInput: string) {
    if (rawInput.trim().length < 4) return;
    setStarted(null);
    try {
      const result = await api.post<{
        intentId: string;
        runId: string;
        graph: Array<{ id: string; agent: string; title: string; dependsOn: string[] }>;
        context: { items: number; confidence: number; sources: Array<{ label: string; count: number }> };
      }>("/api/intents", { input: rawInput });
      setStarted({ ...result, rawInput });
      setInput("");
      void queryClient.invalidateQueries({ queryKey: ["intents"] });
    } catch (err) {
      toast({ tone: "error", title: "Could not start the run", body: err instanceof Error ? err.message : String(err) });
    }
  }

  async function cancel() {
    if (!started) return;
    await api.post(`/api/intents/${started.intentId}/cancel`);
    toast({ tone: "warning", title: "Run cancelled" });
    void queryClient.invalidateQueries({ queryKey: ["intent", started.intentId] });
  }

  async function retry() {
    if (!started) return;
    await api.post(`/api/intents/${started.intentId}/retry`);
    toast({ tone: "info", title: "Retry queued" });
    void queryClient.invalidateQueries({ queryKey: ["intent", started.intentId] });
  }

  const stages = React.useMemo(() => buildStages(state, started), [state, started]);
  const timeline = React.useMemo(() => {
    const persisted = (state?.runs?.[0]?.events ?? []).map((e) => ({ id: e.id, at: e.at, kind: e.kind, message: e.message }));
    const live = events.map((e) => ({ id: e.id, at: e.at, kind: e.type, message: e.message }));
    const merged = new Map<string, { id: string; at: string; kind: string; message: string }>();
    for (const e of [...persisted, ...live]) merged.set(e.id, e);
    return [...merged.values()].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [state, events]);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-8 md:px-8 md:py-12">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-[320px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(59,130,246,0.16),transparent)] blur-2xl" />
        <div className="relative">
          <p className="text-[10.5px] uppercase tracking-[0.2em] text-mute">Command</p>
          <h1 className="mt-3 text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-gradient md:text-[44px]">
            What do you want to accomplish?
          </h1>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-dim">
            NEXUS understands the request, retrieves the context that matters, assembles the right agents and tools,
            executes what it is allowed to execute, asks before it acts on your behalf, and remembers what mattered.
          </p>

          {health?.ai?.demoMode ? (
            <p className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-[10px] border border-violet/25 bg-violet/[0.06] px-3 py-2 text-[11.5px] leading-relaxed text-[#c4b5fd]">
              <span className="font-medium uppercase tracking-[0.1em]">Demo mode</span>
              No external model is configured, so language understanding runs on NEXUS&apos;s deterministic local
              engine. Retrieval, planning, orchestration, tool execution, approvals and memory are real — only the
              language model is simulated, and every simulated call is labelled in Observability.
            </p>
          ) : null}

          <div className="mt-6 panel-raised p-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit(input);
                  }
                }}
                rows={2}
                placeholder="Describe the outcome you want…"
                aria-label="What do you want to accomplish?"
                className="max-h-40 min-h-[56px] flex-1 resize-none bg-transparent px-4 py-4 text-[15px] text-ink placeholder:text-mute/70 outline-none"
              />
              <Button
                variant="primary"
                size="lg"
                className="mb-1 mr-1"
                onClick={() => void submit(input)}
                disabled={input.trim().length < 4}
              >
                Execute <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="rounded-lg border border-line bg-surface-1 px-2.5 py-1 text-[11.5px] text-mute transition-colors hover:border-line-strong hover:text-dim"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Execution ────────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {started ? (
          <motion.section
            key={started.intentId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="mt-8 space-y-5"
          >
            {/* Status header */}
            <div className="panel p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-2 text-[12px] text-mute">
                  {terminal ? (
                    <Check className="h-3.5 w-3.5 text-emerald" />
                  ) : (
                    <Radio className={cn("h-3.5 w-3.5", connected ? "text-accent-bright animate-pulse-soft" : "text-mute")} />
                  )}
                  {connected ? "Live" : terminal ? "Finished" : "Connecting…"}
                </span>
                <span className="text-[13px] text-ink">{started.rawInput}</span>
                {orchestrator ? (
                  <Badge tone={STATUS_TONE[orchestrator.status] ?? "neutral"}>{titleCase(orchestrator.status)}</Badge>
                ) : null}
                <div className="ml-auto flex items-center gap-2">
                  {!terminal ? (
                    <Button variant="ghost" size="sm" onClick={cancel}>
                      <Square className="h-3 w-3" /> Stop
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={retry}>
                      <RotateCcw className="h-3 w-3" /> Retry failed steps
                    </Button>
                  )}
                  <Link href={`/runs/${started.runId}`}>
                    <Button variant="secondary" size="sm">
                      Inspect run
                    </Button>
                  </Link>
                </div>
              </div>
              {orchestrator ? (
                <div className="mt-3">
                  <Progress value={orchestrator.progress ?? 0} />
                </div>
              ) : null}
            </div>

            {/* Stage strip */}
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {stages.map((stage) => (
                <StageCard key={stage.key} stage={stage} />
              ))}
            </div>

            {/* Graph + timeline */}
            <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Execution graph</CardTitle>
                  <p className="text-[11.5px] text-mute mt-1">
                    Independent branches run in parallel; dependents wait; approvals halt the graph.
                  </p>
                </CardHeader>
                <CardContent className="pt-2">
                  {started.graph.length ? (
                    <ExecutionGraph
                      nodes={started.graph.map((n) => ({ ...n, status: "PENDING" })) as GraphNode[]}
                      runs={state?.runs?.[0]?.children ?? []}
                    />
                  ) : null}
                </CardContent>
              </Card>

              <Card className="flex flex-col">
                <CardHeader>
                  <CardTitle>Execution timeline</CardTitle>
                  <p className="text-[11.5px] text-mute mt-1">Useful execution events — no hidden reasoning.</p>
                </CardHeader>
                <CardContent className="pt-2 max-h-[420px] overflow-y-auto">
                  {timeline.length ? (
                    <ol className="space-y-2.5">
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
                  ) : (
                    <p className="py-8 text-center text-[12px] text-mute">
                      {isLoading ? "Loading execution events…" : "Waiting for the first event…"}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Approvals */}
            {state?.approvals?.length ? (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-ink">Approvals</h3>
                  <Badge tone={state.approvals.some((a) => a.status === "PENDING") ? "warning" : "success"}>
                    {state.approvals.filter((a) => a.status === "PENDING").length} pending
                  </Badge>
                  {state.approvals.some((a) => a.status === "PENDING") ? (
                    <Button
                      variant="primary"
                      size="sm"
                      className="ml-auto"
                      onClick={async () => {
                        await api.post(`/api/intents/${started.intentId}/approve`);
                        toast({ tone: "success", title: "All actions approved", body: "NEXUS resumed execution." });
                        void queryClient.invalidateQueries({ queryKey: ["intent", started.intentId] });
                      }}
                    >
                      Approve all
                    </Button>
                  ) : null}
                </div>
                {state.approvals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    onResolved={() => void queryClient.invalidateQueries({ queryKey: ["intent", started.intentId] })}
                  />
                ))}
              </section>
            ) : null}

            {/* Result */}
            {state?.result ? (
              <ResultPanel result={state.result as RunResult} intentId={started.intentId} runId={started.runId} />
            ) : null}
          </motion.section>
        ) : (
          /* ── Idle dashboard ───────────────────────────────────────────── */
          <motion.section
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-10 grid gap-5 lg:grid-cols-3"
          >
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Recent intent</CardTitle>
                <p className="text-[11.5px] text-mute mt-1">Every request you have run through NEXUS.</p>
              </CardHeader>
              <CardContent className="pt-3">
                {recent?.intents?.length ? (
                  <ul className="space-y-2">
                    {recent.intents.slice(0, 6).map((intent) => (
                      <li key={intent.id}>
                        <Link
                          href={`/runs/${intent.runs[0]?.id ?? intent.id}`}
                          className="flex items-center gap-3 rounded-[10px] border border-line bg-surface-1 px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-surface-2"
                        >
                          <Clock className="h-3.5 w-3.5 text-mute" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-ink">{intent.rawInput}</span>
                            <span className="block text-[11px] text-mute">
                              {titleCase(intent.objective)} · {relativeTime(intent.createdAt)}
                            </span>
                          </span>
                          <Badge tone={STATUS_TONE[intent.runs[0]?.status ?? intent.status] ?? "neutral"}>
                            {titleCase(intent.runs[0]?.status ?? intent.status)}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-8 text-center text-[12.5px] text-mute">
                    No intents yet. Describe an outcome above to start the pipeline.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Memory context</CardTitle>
                <p className="text-[11.5px] text-mute mt-1">What NEXUS will bring into the next run.</p>
              </CardHeader>
              <CardContent className="pt-3">
                {memory?.memories?.length ? (
                  <ul className="space-y-2.5">
                    {memory.memories.slice(0, 5).map((item) => (
                      <li key={item.id} className="flex gap-2.5">
                        <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet" />
                        <span className="text-[12px] leading-relaxed text-dim">{truncate(item.content, 110)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-8 text-center text-[12.5px] text-mute">No memories stored yet.</p>
                )}
                <Link href="/settings#memory" className="mt-3 block text-[11.5px] text-accent-bright hover:underline">
                  Manage memory
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Projects</CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                {projects?.projects?.length ? (
                  <ul className="space-y-2">
                    {projects.projects.slice(0, 5).map((project) => (
                      <li key={project.id}>
                        <Link
                          href={`/projects/${project.id}`}
                          className="flex items-center gap-3 rounded-[10px] border border-line bg-surface-1 px-3 py-2.5 hover:border-line-strong transition-colors"
                        >
                          <span className="h-2 w-2 rounded-full" style={{ background: project.color }} />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{project.name}</span>
                          <Badge tone={STATUS_TONE[project.health] ?? "neutral"}>{titleCase(project.health)}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-8 text-center text-[12.5px] text-mute">No projects yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Open work</CardTitle>
                <p className="text-[11.5px] text-mute mt-1">
                  {tasks?.summary?.overdue ? `${tasks.summary.overdue} overdue · ` : ""}
                  {tasks?.summary?.blocked ? `${tasks.summary.blocked} blocked` : "No blockers"}
                </p>
              </CardHeader>
              <CardContent className="pt-3">
                {tasks?.tasks?.length ? (
                  <ul className="space-y-2">
                    {tasks.tasks.slice(0, 6).map((task) => (
                      <li key={task.id} className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            task.status === "DONE"
                              ? "bg-emerald"
                              : task.status === "BLOCKED"
                                ? "bg-amber"
                                : task.priority === "URGENT"
                                  ? "bg-red"
                                  : "bg-mute",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-dim">{task.title}</span>
                        <span className="text-[11px] text-mute">{relativeTime(task.dueDate)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-8 text-center text-[12.5px] text-mute">No tasks yet.</p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Suggested actions</CardTitle>
              </CardHeader>
              <CardContent className="pt-3 space-y-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => router.push("/projects?new=1")}
                >
                  <FolderKanban className="h-3.5 w-3.5" /> Create a project
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => router.push("/documents")}
                >
                  <Search className="h-3.5 w-3.5" /> Ingest documents
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => router.push("/workflows")}
                >
                  <Activity className="h-3.5 w-3.5" /> Build a workflow
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setInput("Review my unfinished tasks and tell me what is at risk.")}
                >
                  <Sparkles className="h-3.5 w-3.5" /> Review what is at risk
                </Button>
              </CardContent>
            </Card>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

type Stage = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "waiting" | "failed";
  detail?: string;
};

function buildStages(state: IntentState | undefined, started: Started | null): Stage[] {
  const eventKinds = new Set((state?.runs?.[0]?.events ?? []).map((e) => e.kind));
  const intentDone = eventKinds.has("INTENT_UNDERSTOOD");
  const contextDone = eventKinds.has("CONTEXT_RETRIEVED");
  const contextEvent = (state?.runs?.[0]?.events ?? []).find((e) => e.kind === "CONTEXT_RETRIEVED");
  const children = state?.runs?.[0]?.children ?? [];
  const result = state?.result;

  const stages: Stage[] = [
    {
      key: "intent",
      label: "Understanding",
      status: intentDone ? "done" : started ? "active" : "pending",
      detail: state?.intent ? `${state.intent.objective}${state.intent.deadlineText ? ` · ${state.intent.deadlineText}` : ""}` : undefined,
    },
    {
      key: "context",
      label: "Context",
      status: contextDone ? "done" : intentDone ? "active" : "pending",
      detail: contextEvent ? String(contextEvent.message) : undefined,
    },
  ];

  for (const run of children) {
    stages.push({
      key: run.key,
      label: run.name.replace(" Agent", ""),
      status:
        run.status === "COMPLETED"
          ? "done"
          : run.status === "WAITING_APPROVAL"
            ? "waiting"
            : run.status === "FAILED" || run.status === "CANCELLED"
              ? "failed"
              : run.status === "RUNNING" || run.status === "PLANNING"
                ? "active"
                : "pending",
      detail: run.error ?? run.step ?? undefined,
    });
  }

  stages.push({
    key: "result",
    label: "Result",
    status: result ? "done" : children.length && children.every((c) => c.status === "COMPLETED") ? "active" : "pending",
  });

  return stages;
}

function StageCard({ stage }: { stage: Stage }) {
  const tone =
    stage.status === "done"
      ? "border-emerald/25"
      : stage.status === "waiting"
        ? "border-amber/35"
        : stage.status === "failed"
          ? "border-red/30"
          : stage.status === "active"
            ? "border-accent/40"
            : "border-line";

  return (
    <div className={cn("rounded-[12px] border bg-surface-1 px-3 py-2.5 transition-colors", tone)}>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            stage.status === "done"
              ? "bg-emerald"
              : stage.status === "waiting"
                ? "bg-amber"
                : stage.status === "failed"
                  ? "bg-red"
                  : stage.status === "active"
                    ? "bg-accent animate-pulse-soft"
                    : "bg-mute/50",
          )}
        />
        <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-dim">{stage.label}</span>
        {stage.status === "active" ? <Loader2 className="ml-auto h-3 w-3 animate-spin text-accent-bright" /> : null}
      </div>
      {stage.detail ? <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-mute">{stage.detail}</p> : null}
    </div>
  );
}
