'use client';

import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Brain,
  CalendarClock,
  CheckCircle2,
  Cpu,
  FileText,
  Flag,
  Layers,
  Lightbulb,
  Network,
  Target,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Progress } from '@/components/ui/misc';
import { cn, relativeTime, truncate } from '@/lib/utils';

export interface ProjectPayload {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  summary: string | null;
  status: string;
  progress: number;
  deadline: string | null;
  priority: string;
}

export interface HealthPayload {
  health: string;
  healthScore: number;
  progress: number;
  openTasks: number;
  completedTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  deadlineDays: number | null;
  blockers: string[];
  risks: string[];
}

type Tab = 'overview' | 'intelligence' | 'work' | 'knowledge' | 'activity';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'work', label: 'Work' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'activity', label: 'Activity' },
];

export function ProjectWorkspace({
  project,
  health,
  tasks,
  documents,
  knowledge,
  relations,
  milestones,
  artifacts,
  activities,
  runs,
}: {
  project: ProjectPayload;
  health: HealthPayload;
  tasks: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    deadline: string | null;
    assignee: string | null;
    source: string;
    createdByAgent: string | null;
  }[];
  documents: { id: string; title: string; status: string; chunkCount: number; wordCount: number; updatedAt: string }[];
  knowledge: { id: string; title: string; type: string; content: string | null; confidence: number }[];
  relations: { id: string; fromId: string; toId: string; type: string; weight: number }[];
  milestones: { id: string; title: string; description: string | null; status: string; dueDate: string | null }[];
  artifacts: { id: string; title: string; type: string; createdAt: string }[];
  activities: { id: string; type: string; action: string; summary: string; severity: string; createdAt: string }[];
  runs: { id: string; status: string; agent: { name: string; key: string }; durationMs: number | null; createdAt: string }[];
}) {
  const [tab, setTab] = React.useState<Tab>('overview');

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="relative border-b border-line p-6">
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0 max-w-2xl">
              <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">{project.name}</h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
                {project.objective ?? project.summary ?? project.description ?? 'No objective recorded yet.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{project.status.replace('_', ' ')}</Badge>
                <Badge variant="outline">{project.priority}</Badge>
                {project.deadline ? (
                  <Badge variant={health.deadlineDays !== null && health.deadlineDays <= 2 ? 'warn' : 'default'}>
                    <CalendarClock className="mr-1 h-3 w-3" /> {relativeTime(project.deadline)}
                  </Badge>
                ) : null}
                <Badge variant="accent">health score {health.healthScore}</Badge>
              </div>
            </div>

            <div className="w-full max-w-xs">
              <div className="flex items-center justify-between text-2xs text-ink-faint">
                <span>Progress</span>
                <span className="font-mono">{health.progress}%</span>
              </div>
              <Progress value={health.progress} className="mt-2" tone={health.health === 'BLOCKED' ? 'bad' : health.health === 'AT_RISK' ? 'warn' : 'accent'} />
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <MiniStat value={health.openTasks} label="Open" />
                <MiniStat value={health.overdueTasks} label="Overdue" tone={health.overdueTasks ? 'bad' : 'default'} />
                <MiniStat value={health.blockedTasks} label="Blocked" tone={health.blockedTasks ? 'bad' : 'default'} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto px-4">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                'relative px-3 py-3 text-[13px] transition-colors',
                tab === item.id ? 'text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              {item.label}
              {tab === item.id ? (
                <motion.span layoutId="project-tab" className="absolute inset-x-2 -bottom-px h-px bg-accent shadow-[0_0_8px_rgba(61,126,255,0.9)]" />
              ) : null}
            </button>
          ))}
        </div>
      </Card>

      {/* ── Overview ───────────────────────────────────────────────────── */}
      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <Target className="h-3.5 w-3.5 text-accent-soft" /> Current objective
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-[14px] leading-relaxed text-ink">
                {project.objective ?? 'No objective has been set. NEXUS can derive one from your documents and tasks.'}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-surface-2/40 p-4">
                  <p className="label mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" /> Blockers
                  </p>
                  {health.blockers.length ? (
                    <ul className="space-y-1.5">
                      {health.blockers.map((b) => (
                        <li key={b} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-muted">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-bad" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] text-ink-faint">No blockers detected.</p>
                  )}
                </div>

                <div className="rounded-xl border border-line bg-surface-2/40 p-4">
                  <p className="label mb-2 flex items-center gap-1.5">
                    <Lightbulb className="h-3 w-3" /> Risks
                  </p>
                  {health.risks.length ? (
                    <ul className="space-y-1.5">
                      {health.risks.map((r) => (
                        <li key={r} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-muted">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warn" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] text-ink-faint">No risks detected from current state.</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-line bg-surface-2/40 p-4">
                <p className="label mb-2.5 flex items-center gap-1.5">
                  <Flag className="h-3 w-3" /> Milestones
                </p>
                {milestones.length ? (
                  <ol className="space-y-2.5">
                    {milestones.map((milestone, index) => (
                      <li key={milestone.id} className="flex items-start gap-3">
                        <span
                          className={cn(
                            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium',
                            milestone.status === 'COMPLETED'
                              ? 'border-good/40 bg-good/10 text-good'
                              : milestone.status === 'IN_PROGRESS'
                                ? 'border-accent/40 bg-accent/10 text-accent-soft'
                                : 'border-line text-ink-faint',
                          )}
                        >
                          {milestone.status === 'COMPLETED' ? <CheckCircle2 className="h-3 w-3" /> : index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] text-ink">{milestone.title}</span>
                          <span className="block text-2xs text-ink-faint">
                            {milestone.description ?? '—'}
                            {milestone.dueDate ? ` · ${relativeTime(milestone.dueDate)}` : ''}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[12.5px] text-ink-faint">No milestones defined.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[14px]">
                  <FileText className="h-3.5 w-3.5 text-ink-faint" /> Related documents
                </CardTitle>
                <Link href="/documents" className="text-2xs text-accent-soft hover:underline">
                  All
                </Link>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {documents.length ? (
                  documents.slice(0, 6).map((doc) => (
                    <Link
                      key={doc.id}
                      href={`/documents/${doc.id}`}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{doc.title}</span>
                      <span className="shrink-0 text-2xs text-ink-faint">{doc.chunkCount} chunks</span>
                    </Link>
                  ))
                ) : (
                  <p className="px-2 py-3 text-[13px] text-ink-faint">No documents indexed yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[14px]">
                  <Cpu className="h-3.5 w-3.5 text-ink-faint" /> Recent agent runs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {runs.length ? (
                  runs.slice(0, 6).map((run) => (
                    <div key={run.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{run.agent.name}</span>
                      <Badge variant={run.status === 'COMPLETED' ? 'good' : run.status === 'FAILED' ? 'bad' : 'default'}>
                        {run.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="px-2 py-3 text-[13px] text-ink-faint">NEXUS has not run against this project yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ── Intelligence ───────────────────────────────────────────────── */}
      {tab === 'intelligence' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <Brain className="h-3.5 w-3.5 text-violet-soft" /> Project intelligence
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <IntelligenceRow label="Health" value={`${health.health.replace('_', ' ')} (${health.healthScore}/100)`} />
              <IntelligenceRow label="Progress" value={`${health.progress}% · ${health.completedTasks}/${health.completedTasks + health.openTasks} tasks done`} />
              <IntelligenceRow
                label="Deadline"
                value={
                  health.deadlineDays === null
                    ? 'No deadline set'
                    : health.deadlineDays < 0
                      ? `Overdue by ${Math.abs(health.deadlineDays)} day(s)`
                      : `${health.deadlineDays} day(s) remaining`
                }
              />
              <IntelligenceRow label="Execution load" value={`${health.openTasks} open · ${health.blockedTasks} blocked · ${health.overdueTasks} overdue`} />
              <IntelligenceRow label="Knowledge base" value={`${knowledge.length} items · ${documents.length} documents indexed`} />
              <IntelligenceRow label="Agent activity" value={`${runs.length} run(s) recorded`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <Lightbulb className="h-3.5 w-3.5 text-warn" /> Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {health.blockers.map((b) => (
                <Recommendation key={b} tone="bad" text={b} />
              ))}
              {health.risks.map((r) => (
                <Recommendation key={r} tone="warn" text={r} />
              ))}
              {!health.blockers.length && !health.risks.length ? (
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  Project state is consistent. NEXUS has no interventions to recommend right now.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ── Work ───────────────────────────────────────────────────────── */}
      {tab === 'work' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <Layers className="h-3.5 w-3.5 text-ink-faint" /> Tasks
            </CardTitle>
            <Link href="/tasks" className="text-2xs text-accent-soft hover:underline">
              Open task board
            </Link>
          </CardHeader>
          <CardContent>
            {tasks.length ? (
              <div className="space-y-1.5">
                {tasks.map((task) => {
                  const late = task.deadline && new Date(task.deadline).getTime() < Date.now() && task.status !== 'DONE';
                  return (
                    <div key={task.id} className="flex items-start gap-3 rounded-lg border border-line bg-surface-2/40 p-3">
                      <span
                        className={cn(
                          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                          task.status === 'DONE'
                            ? 'bg-good'
                            : task.status === 'BLOCKED'
                              ? 'bg-bad'
                              : task.status === 'IN_PROGRESS'
                                ? 'bg-accent'
                                : 'bg-ink-faint',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[13.5px] text-ink', task.status === 'DONE' && 'line-through opacity-60')}>
                          {task.title}
                        </span>
                        {task.description ? (
                          <span className="mt-0.5 block text-2xs leading-relaxed text-ink-faint">{truncate(task.description, 120)}</span>
                        ) : null}
                      </span>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="flex gap-1.5">
                          <Badge variant="outline">{task.priority}</Badge>
                          <Badge variant={task.status === 'DONE' ? 'good' : task.status === 'BLOCKED' ? 'bad' : 'default'}>
                            {task.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <span className={cn('text-2xs', late ? 'text-bad' : 'text-ink-faint')}>
                          {task.deadline ? relativeTime(task.deadline) : 'No deadline'}
                        </span>
                        {task.createdByAgent ? (
                          <span className="text-[10px] text-violet-soft">created by {task.createdByAgent} agent</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={Layers} title="No tasks in this project" description="NEXUS can generate a task plan from your objective." />
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Knowledge ──────────────────────────────────────────────────── */}
      {tab === 'knowledge' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <Network className="h-3.5 w-3.5 text-ink-faint" /> Knowledge items
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {knowledge.length ? (
                knowledge.slice(0, 20).map((item) => (
                  <div key={item.id} className="rounded-lg border border-line bg-surface-2/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="label">{item.type}</span>
                      <span className="font-mono text-2xs text-ink-faint">{(item.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <p className="mt-1 text-[13px] font-medium text-ink">{item.title}</p>
                    {item.content ? <p className="mt-1 text-2xs leading-relaxed text-ink-muted">{truncate(item.content, 140)}</p> : null}
                  </div>
                ))
              ) : (
                <EmptyState icon={Network} title="No knowledge items yet" description="Upload documents or add knowledge to build the graph." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <Network className="h-3.5 w-3.5 text-ink-faint" /> Relationships
              </CardTitle>
            </CardHeader>
            <CardContent>
              {relations.length ? (
                <div className="space-y-1.5">
                  {relations.slice(0, 25).map((rel) => {
                    const from = knowledge.find((k) => k.id === rel.fromId);
                    const to = knowledge.find((k) => k.id === rel.toId);
                    return (
                      <div key={rel.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[12.5px]">
                        <span className="truncate text-ink">{from?.title ?? rel.fromId.slice(0, 8)}</span>
                        <Badge variant="violet">{rel.type.replace('_', ' ')}</Badge>
                        <span className="truncate text-ink">{to?.title ?? rel.toId.slice(0, 8)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-2 py-3 text-[13px] text-ink-faint">No relationships recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ── Activity ───────────────────────────────────────────────────── */}
      {tab === 'activity' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activities.length ? (
              <div className="space-y-1">
                {activities.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 rounded-lg px-2 py-2">
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        item.severity === 'ERROR' ? 'bg-bad' : item.severity === 'WARNING' ? 'bg-warn' : item.severity === 'SUCCESS' ? 'bg-good' : 'bg-ink-faint',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-ink">{item.action}</span>
                      <span className="block text-2xs leading-relaxed text-ink-faint">{item.summary}</span>
                    </span>
                    <span className="shrink-0 text-2xs text-ink-faint">{relativeTime(item.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={Cpu} title="No activity yet" />
            )}
          </CardContent>
        </Card>
      ) : null}

      {artifacts.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <FileText className="h-3.5 w-3.5 text-ink-faint" /> Artifacts
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {artifacts.map((artifact) => (
              <Link
                key={artifact.id}
                href={`/api/artifacts/${artifact.id}/download`}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2.5 transition-colors hover:bg-surface-3/50"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{artifact.title}</span>
                <Badge variant="outline">{artifact.type}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MiniStat({ value, label, tone = 'default' }: { value: number; label: string; tone?: 'default' | 'bad' }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 py-2">
      <p className={cn('text-[18px] font-semibold leading-none', tone === 'bad' ? 'text-bad' : 'text-ink')}>{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-ink-faint">{label}</p>
    </div>
  );
}

function IntelligenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-faint pb-2.5 last:border-0">
      <span className="label">{label}</span>
      <span className="text-right text-[13px] text-ink">{value}</span>
    </div>
  );
}

function Recommendation({ tone, text }: { tone: 'warn' | 'bad'; text: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border p-3 text-[13px] leading-relaxed',
        tone === 'bad' ? 'border-bad/25 bg-bad/5 text-ink' : 'border-warn/25 bg-warn/5 text-ink',
      )}
    >
      <AlertTriangle className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone === 'bad' ? 'text-bad' : 'text-warn')} />
      {text}
    </div>
  );
}

export { Button };
