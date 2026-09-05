'use client';

import * as React from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  Cpu,
  Database,
  FileText,
  Lightbulb,
  Loader2,
  Network,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/misc';
import { fetchJson, useSession } from '@/hooks/use-session';
import { useToast } from '@/components/ui/toast';
import { cn, formatDuration, relativeTime, truncate } from '@/lib/utils';
import { ExecutionGraph, type GraphEdge, type GraphNode, type GraphNodeState } from './execution-graph';
import { ApprovalCard, type ApprovalRecord } from '@/features/approvals/approval-card';
import type { RunStatus } from '@/types';

interface RunEvent {
  id: string;
  type: string;
  label: string;
  detail: string | null;
  status: string;
  nodeId: string | null;
  createdAt: string;
}

interface RunSummary {
  id: string;
  status: string;
  agent: { key: string; name: string };
  durationMs: number | null;
}

interface IntentDetail {
  intent: {
    id: string;
    objective: string;
    desiredOutcome: string;
    rawInput: string;
    deadlineText: string | null;
    riskLevel: string;
    confidence: number;
    status: string;
    entities: string;
    constraints: string;
    requiredCapabilities: string;
    result: string | null;
    projectId: string | null;
    createdAt: string;
  };
  contextItems: {
    id: string;
    sourceType: string;
    title: string;
    snippet: string;
    relevance: number;
    rationale: string;
  }[];
  artifacts: { id: string; title: string; type: string; createdAt: string }[];
  approvals: ApprovalRecord[];
  runs: { id: string; status: string; agent: { key: string; name: string }; durationMs: number | null; outputs: string }[];
}

const EVENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  INTENT: Target,
  CONTEXT: Database,
  PLAN: Lightbulb,
  AGENT: Cpu,
  TOOL: Wrench,
  APPROVAL: ShieldCheck,
  VALIDATION: CheckCircle2,
  RESULT: Sparkles,
  MEMORY: Brain,
  ERROR: AlertTriangle,
  CANCEL: Ban,
};

function stateForRun(status: string): GraphNodeState {
  switch (status) {
    case 'COMPLETED':
      return 'COMPLETED';
    case 'RUNNING':
    case 'PLANNING':
      return 'RUNNING';
    case 'WAITING_APPROVAL':
      return 'WAITING';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'SKIPPED';
    case 'QUEUED':
      return 'QUEUED';
    default:
      return 'IDLE';
  }
}

export function ExecutionView({
  intentId,
  onClose,
  autoStart,
}: {
  intentId: string;
  onClose?: () => void;
  autoStart?: boolean;
}) {
  const { data: session } = useSession();
  const { push } = useToast();
  const [events, setEvents] = React.useState<RunEvent[]>([]);
  const [runs, setRuns] = React.useState<RunSummary[]>([]);
  const [status, setStatus] = React.useState('RECEIVED');
  const [detail, setDetail] = React.useState<IntentDetail | null>(null);
  const [expandedContext, setExpandedContext] = React.useState(false);
  const [showTimeline, setShowTimeline] = React.useState(true);
  const [cancelling, setCancelling] = React.useState(false);

  // Live timeline via SSE.
  React.useEffect(() => {
    if (!intentId) return;
    const source = new EventSource(`/api/intents/${intentId}/events`);
    source.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data) as
          | { type: 'event'; event: RunEvent }
          | { type: 'state'; intentStatus: string; runs: RunSummary[] }
          | { type: 'done'; status: string };

        if (payload.type === 'event') {
          setEvents((prev) => (prev.some((e) => e.id === payload.event.id) ? prev : [...prev, payload.event]));
        } else if (payload.type === 'state') {
          setStatus(payload.intentStatus);
          setRuns(payload.runs);
        } else if (payload.type === 'done') {
          setStatus(payload.status);
          void loadDetail();
          source.close();
        }
      } catch {
        /* ignore malformed frame */
      }
    };
    source.onerror = () => {
      /* EventSource retries automatically; close after terminal state handled above */
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId]);

  const loadDetail = React.useCallback(async () => {
    try {
      const data = await fetchJson<IntentDetail>(`/api/intents/${intentId}`);
      setDetail(data);
      setStatus(data.intent.status);
      setRuns(
        data.runs.map((r) => ({ id: r.id, status: r.status, agent: r.agent, durationMs: r.durationMs })),
      );
      if (data.intent.status === 'COMPLETED' || data.intent.status === 'FAILED') {
        const full = await fetchJson<{ events: RunEvent[] }>(`/api/intents/${intentId}`);
        void full;
      }
    } catch {
      /* detail is optional while streaming */
    }
  }, [intentId]);

  React.useEffect(() => {
    void loadDetail();
    const id = setInterval(() => {
      if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') return;
      void loadDetail();
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId, status]);

  const parsedResult = React.useMemo(() => {
    if (!detail?.intent.result) return null;
    try {
      return JSON.parse(detail.intent.result) as {
        result: {
          taskCount: number;
          tasksCreated: number;
          tasksScheduled: number;
          recommendations: string[];
          artifacts: { id: string; title: string; type: string }[];
          validation: { passed: boolean; passedChecks: number; checks: { name: string; passed: boolean; detail: string }[] };
        };
        memoryUpdates: { content: string; type: string; importance: number }[];
        tools: string[];
        agents: string[];
      };
    } catch {
      return null;
    }
  }, [detail]);

  // ── Graph ────────────────────────────────────────────────────────────────
  const graphNodes = React.useMemo<GraphNode[]>(() => {
    const runFor = (key: string) => runs.find((r) => r.agent.key === key);
    const nodes: GraphNode[] = [
      { id: 'intent', label: 'Intent', state: events.some((e) => e.type === 'INTENT') ? 'COMPLETED' : 'RUNNING' },
      {
        id: 'context',
        label: `Context${detail ? ` ${detail.contextItems.length}` : ''}`,
        state: events.some((e) => e.type === 'CONTEXT') ? 'COMPLETED' : events.some((e) => e.type === 'INTENT') ? 'RUNNING' : 'IDLE',
      },
    ];

    for (const key of ['planning', 'research', 'knowledge', 'analyst', 'creative', 'execution', 'review'] as const) {
      const run = runFor(key);
      if (!run && !['planning', 'research', 'knowledge', 'execution', 'review'].includes(key)) continue;
      const label = key === 'planning' ? 'Planning' : key === 'research' ? 'Research' : key === 'knowledge' ? 'Knowledge' : key === 'analyst' ? 'Analyst' : key === 'creative' ? 'Creative' : key === 'execution' ? 'Execution' : 'Review';
      nodes.push({
        id: key,
        label,
        state: run ? stateForRun(run.status) : 'IDLE',
        sublabel: run?.durationMs ? formatDuration(run.durationMs) : undefined,
      });
    }

    const pendingApprovals = detail?.approvals.filter((a) => a.status === 'PENDING').length ?? 0;
    const decidedApprovals = detail?.approvals.filter((a) => a.status !== 'PENDING').length ?? 0;
    nodes.push({
      id: 'approval',
      label: pendingApprovals ? `Approval ${pendingApprovals}` : decidedApprovals ? 'Approved' : 'Approval',
      state: pendingApprovals ? 'WAITING' : decidedApprovals ? 'COMPLETED' : 'IDLE',
    });

    nodes.push({
      id: 'validation',
      label: 'Validation',
      state: parsedResult ? (parsedResult.result.validation.passed ? 'COMPLETED' : 'FAILED') : events.some((e) => e.type === 'VALIDATION') ? 'COMPLETED' : 'IDLE',
    });
    nodes.push({
      id: 'result',
      label: 'Result',
      state: status === 'COMPLETED' ? 'COMPLETED' : status === 'FAILED' ? 'FAILED' : 'IDLE',
    });

    return nodes;
  }, [runs, events, detail, parsedResult, status]);

  const graphEdges = React.useMemo<GraphEdge[]>(() => {
    const ids = new Set(graphNodes.map((n) => n.id));
    const pairs: [string, string][] = [
      ['intent', 'context'],
      ['context', 'planning'],
      ['planning', 'research'],
      ['planning', 'knowledge'],
      ['research', 'analyst'],
      ['knowledge', 'analyst'],
      ['research', 'creative'],
      ['knowledge', 'creative'],
      ['research', 'execution'],
      ['knowledge', 'execution'],
      ['analyst', 'execution'],
      ['creative', 'execution'],
      ['planning', 'execution'],
      ['execution', 'approval'],
      ['approval', 'review'],
      ['review', 'validation'],
      ['validation', 'result'],
    ];
    return pairs
      .filter(([from, to]) => ids.has(from) && ids.has(to))
      .map(([from, to]) => ({ from, to }));
  }, [graphNodes]);

  const active = status === 'WAITING_APPROVAL' || status === 'EXECUTING' || status === 'PLANNING' || status === 'RECEIVED' || status === 'UNDERSTOOD';
  const pendingApprovals = detail?.approvals.filter((a) => a.status === 'PENDING') ?? [];
  const completedSteps = graphNodes.filter((n) => n.state === 'COMPLETED').length;

  async function cancel() {
    setCancelling(true);
    try {
      await fetchJson(`/api/intents/${intentId}/cancel`, { method: 'POST' });
      push({ title: 'Run cancelled', tone: 'info' });
      setStatus('CANCELLED');
      void loadDetail();
    } catch (error) {
      push({ title: 'Cancel failed', description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Status header ─────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <StatusOrb status={status} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-ink">
              {detail?.intent.objective ?? 'Understanding your intent…'}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-ink-muted">
              {statusLabel(status)}
              {detail?.intent.deadlineText ? ` · deadline ${detail.intent.deadlineText}` : ''}
            </p>
          </div>
          {active ? (
            <Button variant="ghost" size="sm" loading={cancelling} onClick={cancel}>
              <Ban className="h-3.5 w-3.5" /> Cancel
            </Button>
          ) : null}
          {onClose ? (
            <Button variant="ghost" size="sm" onClick={onClose}>
              New command
            </Button>
          ) : null}
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* Execution graph */}
          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="label">Execution graph</p>
              <span className="font-mono text-2xs text-ink-faint">
                {completedSteps}/{graphNodes.length} nodes
              </span>
            </div>
            <ExecutionGraph nodes={graphNodes} edges={graphEdges} height={420} />
          </div>

          {/* Timeline */}
          <div className="flex min-w-0 flex-col rounded-xl border border-line bg-surface-2/40">
            <button
              onClick={() => setShowTimeline((v) => !v)}
              className="flex items-center justify-between px-3.5 py-2.5 text-left"
            >
              <span className="label">Execution timeline</span>
              <span className="flex items-center gap-2 text-2xs text-ink-faint">
                {events.length} events
                {showTimeline ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {showTimeline ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="max-h-[380px] space-y-0 overflow-y-auto px-3.5 pb-3.5">
                    {events.length === 0 ? (
                      <p className="py-6 text-center text-[13px] text-ink-faint">Waiting for the first event…</p>
                    ) : (
                      events.map((event, index) => {
                        const Icon = EVENT_ICON[event.type] ?? CircleDot;
                        const isLast = index === events.length - 1;
                        return (
                          <motion.div
                            key={event.id}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.2 }}
                            className="relative flex gap-3 pb-3.5"
                          >
                            {!isLast ? (
                              <span className="absolute left-[11px] top-6 h-[calc(100%-16px)] w-px bg-line" />
                            ) : null}
                            <span
                              className={cn(
                                'relative mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border',
                                event.status === 'COMPLETED' && 'border-good/30 bg-good/10 text-good',
                                event.status === 'RUNNING' && 'border-accent/40 bg-accent/10 text-accent-soft',
                                event.status === 'WAITING' && 'border-warn/40 bg-warn/10 text-warn',
                                event.status === 'FAILED' && 'border-bad/40 bg-bad/10 text-bad',
                                event.status === 'PENDING' && 'border-line bg-surface-2 text-ink-faint',
                              )}
                            >
                              {event.status === 'RUNNING' ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Icon className="h-3 w-3" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] leading-snug text-ink">{event.label}</p>
                              {event.detail ? (
                                <p className="mt-0.5 break-words text-2xs leading-relaxed text-ink-faint">{event.detail}</p>
                              ) : null}
                            </div>
                            <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                              {new Date(event.createdAt).toLocaleTimeString(undefined, {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                          </motion.div>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Context ─────────────────────────────────────────────────────── */}
        {detail && detail.contextItems.length > 0 ? (
          <div className="border-t border-line p-4">
            <button
              onClick={() => setExpandedContext((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-ink-faint" />
                <span className="label">Context retrieved</span>
                <Badge variant="accent">{detail.contextItems.length} items</Badge>
              </span>
              {expandedContext ? <ChevronDown className="h-3.5 w-3.5 text-ink-faint" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-faint" />}
            </button>

            <AnimatePresence initial={false}>
              {expandedContext ? (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {detail.contextItems.map((item) => (
                      <div key={item.id} className="rounded-lg border border-line bg-surface-2/50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <span className="label">{item.sourceType.replace('_', ' ')}</span>
                          <span className="font-mono text-2xs text-accent-soft">{item.relevance.toFixed(3)}</span>
                        </div>
                        <p className="mt-1.5 text-[13px] font-medium leading-snug text-ink">{item.title}</p>
                        <p className="mt-1 text-2xs leading-relaxed text-ink-muted">{truncate(item.snippet, 160)}</p>
                        <p className="mt-2 border-t border-line-faint pt-2 text-2xs italic leading-relaxed text-ink-faint">
                          {item.rationale}
                        </p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}
      </Card>

      {/* ── Approvals ─────────────────────────────────────────────────────── */}
      {pendingApprovals.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-warn" />
            <h2 className="text-[15px] font-semibold text-ink">Approval required</h2>
            <Badge variant="warn">{pendingApprovals.length} pending</Badge>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Execution is paused. NEXUS will not continue until you approve, modify or deny these actions.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {pendingApprovals.map((approval) => (
              <ApprovalCard key={approval.id} approval={approval} onDecided={loadDetail} />
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Result ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {status === 'COMPLETED' && parsedResult ? (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative overflow-hidden rounded-2xl border border-line bg-surface-1/70 p-6 shadow-panel backdrop-blur-2xl"
          >
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent/12 blur-3xl" />
            <div className="relative">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent-soft" />
                <span className="label">Result</span>
              </div>
              <h2 className="mt-3 text-[26px] font-semibold tracking-[-0.02em] text-ink sm:text-[32px]">
                {resultHeadline(detail?.intent.objective ?? '')}
              </h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
                {detail?.intent.desiredOutcome}
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <StatTile
                  icon={CircleDot}
                  value={parsedResult.result.taskCount}
                  label="Tasks in plan"
                  detail={`${parsedResult.result.tasksCreated} created · ${parsedResult.result.tasksScheduled} scheduled`}
                />
                <StatTile
                  icon={Lightbulb}
                  value={parsedResult.result.recommendations.length}
                  label="Recommendations"
                  detail="From the Review Agent"
                />
                <StatTile
                  icon={ShieldCheck}
                  value={detail?.approvals.length ?? 0}
                  label="Approvals"
                  detail={`${detail?.approvals.filter((a) => a.status === 'APPROVED' || a.status === 'MODIFIED').length ?? 0} approved · ${detail?.approvals.filter((a) => a.status === 'DENIED').length ?? 0} denied`}
                />
              </div>

              {parsedResult.result.recommendations.length ? (
                <div className="mt-5 rounded-xl border border-line bg-surface-2/50 p-4">
                  <p className="label mb-2.5">Recommendations</p>
                  <ul className="space-y-2">
                    {parsedResult.result.recommendations.map((rec, i) => (
                      <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-ink">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-surface-2/50 p-4">
                  <p className="label mb-2.5">Validation</p>
                  <ul className="space-y-1.5">
                    {parsedResult.result.validation.checks.map((check) => (
                      <li key={check.name} className="flex items-start gap-2 text-[12.5px]">
                        {check.passed ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
                        ) : (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />
                        )}
                        <span className="flex-1 text-ink">{check.name}</span>
                        <span className="text-ink-faint">{check.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-line bg-surface-2/50 p-4">
                  <p className="label mb-2.5">Artifacts</p>
                  <ul className="space-y-1.5">
                    {detail?.artifacts.length ? (
                      detail.artifacts.map((artifact) => (
                        <li key={artifact.id}>
                          <Link
                            href={`/api/artifacts/${artifact.id}/download`}
                            className="group flex items-center gap-2 text-[12.5px] text-ink transition-colors hover:text-accent-soft"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                            <span className="flex-1 truncate">{artifact.title}</span>
                            <span className="text-2xs text-ink-faint">{artifact.type}</span>
                            <ArrowRight className="h-3 w-3 text-ink-faint transition-transform group-hover:translate-x-0.5" />
                          </Link>
                        </li>
                      ))
                    ) : (
                      <li className="text-[12.5px] text-ink-faint">No artifacts produced.</li>
                    )}
                  </ul>

                  {parsedResult.memoryUpdates.length ? (
                    <>
                      <p className="label mb-2 mt-4">Memory updated</p>
                      <ul className="space-y-1.5">
                        {parsedResult.memoryUpdates.slice(0, 3).map((memory, i) => (
                          <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-muted">
                            <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-soft" />
                            {truncate(memory.content, 110)}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                {detail?.artifacts.find((a) => a.type === 'PLAN') ? (
                  <Link href={`/api/artifacts/${detail.artifacts.find((a) => a.type === 'PLAN')!.id}/download`}>
                    <Button variant="primary">
                      Review plan <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                ) : null}
                {pendingApprovals.length ? (
                  <Link href="/approvals">
                    <Button variant="secondary">
                      <ShieldCheck className="h-4 w-4" /> Approve actions
                    </Button>
                  </Link>
                ) : null}
                <Link href={`/runs/${intentId}`}>
                  <Button variant="ghost">
                    Inspect run <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {/* ── Failure ───────────────────────────────────────────────────────── */}
      {status === 'FAILED' ? (
        <Card className="border-bad/25">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-bad" />
              <CardTitle>Run failed</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] leading-relaxed text-ink-muted">
              Partial results were preserved. Failed steps are recorded in the run timeline — retry the command or
              inspect the failing step.
            </p>
            <div className="mt-4 flex gap-2">
              <Link href={`/runs/${intentId}`}>
                <Button variant="secondary" size="sm">Inspect failure</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StatusOrb({ status }: { status: string }) {
  const tone =
    status === 'COMPLETED'
      ? 'border-good/40 bg-good/10 text-good'
      : status === 'FAILED'
        ? 'border-bad/40 bg-bad/10 text-bad'
        : status === 'WAITING_APPROVAL'
          ? 'border-warn/40 bg-warn/10 text-warn'
          : 'border-accent/40 bg-accent/10 text-accent-soft';

  const Icon =
    status === 'COMPLETED'
      ? CheckCircle2
      : status === 'FAILED'
        ? XCircle
        : status === 'WAITING_APPROVAL'
          ? ShieldCheck
          : Loader2;

  const animate =
    status === 'COMPLETED' || status === 'FAILED' ? undefined : { rotate: status === 'WAITING_APPROVAL' ? 0 : 360 };

  return (
    <motion.span
      animate={animate}
      transition={animate ? { duration: 2.4, repeat: Infinity, ease: 'linear' } : undefined}
      className={cn('relative flex h-10 w-10 items-center justify-center rounded-xl border', tone)}
    >
      {status === 'WAITING_APPROVAL' ? null : (
        <span className={cn('absolute inset-0 rounded-xl opacity-60', status !== 'COMPLETED' && status !== 'FAILED' && 'animate-pulse-ring', tone.split(' ')[1])} />
      )}
      <Icon className="relative h-4.5 w-4.5" />
    </motion.span>
  );
}

function StatTile({
  icon: Icon,
  value,
  label,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-ink-faint" />
        <span className="label">{label}</span>
      </div>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.03em] text-ink">{value}</p>
      <p className="mt-1.5 text-2xs leading-relaxed text-ink-faint">{detail}</p>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'RECEIVED':
    case 'UNDERSTOOD':
      return 'Parsing intent…';
    case 'PLANNING':
      return 'Retrieving context and planning…';
    case 'EXECUTING':
      return 'Executing agent pipeline…';
    case 'WAITING_APPROVAL':
      return 'Paused — waiting for your approval';
    case 'COMPLETED':
      return 'Completed';
    case 'FAILED':
      return 'Failed';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status.toLowerCase();
  }
}

function resultHeadline(objective: string): string {
  const key = objective.split(' ')[0]?.toLowerCase() ?? '';
  if (key === 'launch') return 'Your launch plan is ready';
  if (key === 'research') return 'Your research is ready';
  if (key === 'analyze') return 'Your analysis is ready';
  if (key === 'prepare') return 'Your deliverable is ready';
  if (key === 'review') return 'Your review is ready';
  if (key === 'find') return 'Here is everything NEXUS found';
  if (key === 'plan') return 'Your plan is ready';
  return 'NEXUS has finished';
}

export { Network, Clock, Progress };
