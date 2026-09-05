"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  CalendarClock,
  CheckCircle2,
  Command,
  FolderKanban,
  Radio,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { cn, relativeTime, titleCase, truncate } from "@/lib/utils";
import type { ProjectSummary, TaskSummary, ActivitySummary, RunStatus } from "@/types/api";

export default function HomePage() {
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ projects: ProjectSummary[] }>("/api/projects?pageSize=8"),
  });
  const { data: tasks } = useQuery({
    queryKey: ["tasks", "dashboard"],
    queryFn: () => api.get<{ tasks: TaskSummary[]; summary: { total: number; done: number; overdue: number; blocked: number } }>("/api/tasks?pageSize=40"),
    refetchInterval: 30_000,
  });
  const { data: runs } = useQuery({
    queryKey: ["agent-runs", "active"],
    queryFn: () => api.get<{ runs: Array<{ id: string; key: string; name: string; status: RunStatus; progress: number; createdAt: string; intent?: { rawInput: string } | null }> }>("/api/agent-runs?active=true"),
    refetchInterval: 4000,
  });
  const { data: approvals } = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => api.get<{ approvals: Array<{ id: string; title: string; permissionLevel: string; createdAt: string; runId: string | null }> }>("/api/approvals?status=PENDING"),
    refetchInterval: 15_000,
  });
  const { data: activity } = useQuery({
    queryKey: ["activity"],
    queryFn: () => api.get<{ activity: ActivitySummary[] }>("/api/activity?pageSize=12"),
    refetchInterval: 20_000,
  });
  const { data: memory } = useQuery({
    queryKey: ["memory", "recent"],
    queryFn: () => api.get<{ memories: Array<{ id: string; content: string; type: string; updatedAt: string }> }>("/api/memory"),
  });

  const upcoming = (tasks?.tasks ?? [])
    .filter((t) => t.status !== "DONE" && t.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
    .slice(0, 6);

  const atRisk = (projects?.projects ?? []).filter((p) => p.health === "AT_RISK" || p.health === "BLOCKED");
  const needsAttention =
    (approvals?.approvals?.length ?? 0) +
    (tasks?.summary?.overdue ?? 0) +
    (tasks?.summary?.blocked ?? 0);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-8 md:px-8">
      <PageHeader
        title="Good to see you"
        description="Here is what is happening across your workspace, what needs your attention, and what NEXUS is working on right now."
        actions={
          <Link href="/command">
            <Button variant="primary" size="md">
              <Command className="h-3.5 w-3.5" /> New command
            </Button>
          </Link>
        }
      />

      {/* Attention strip */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Radio}
          label="Active runs"
          value={String(runs?.runs?.length ?? 0)}
          detail={runs?.runs?.length ? "NEXUS is executing" : "Idle"}
          tone="accent"
        />
        <StatCard
          icon={ShieldCheck}
          label="Pending approvals"
          value={String(approvals?.approvals?.length ?? 0)}
          detail="Waiting on you"
          tone={(approvals?.approvals?.length ?? 0) > 0 ? "warning" : "neutral"}
        />
        <StatCard
          icon={AlertTriangle}
          label="Needs attention"
          value={String(needsAttention)}
          detail={`${tasks?.summary?.overdue ?? 0} overdue · ${tasks?.summary?.blocked ?? 0} blocked`}
          tone={needsAttention > 0 ? "warning" : "success"}
        />
        <StatCard
          icon={CheckCircle2}
          label="Task completion"
          value={`${Math.round(((tasks?.summary?.done ?? 0) / Math.max(1, tasks?.summary?.total ?? 1)) * 100)}%`}
          detail={`${tasks?.summary?.done ?? 0} of ${tasks?.summary?.total ?? 0} tasks`}
          tone="success"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Active runs */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>What NEXUS is working on</CardTitle>
              <p className="text-[11.5px] text-mute mt-1">Live agent orchestration state.</p>
            </div>
            <Link href="/activity" className="text-[11.5px] text-accent-bright hover:underline">
              Activity
            </Link>
          </CardHeader>
          <CardContent className="pt-3">
            {runs?.runs?.length ? (
              <ul className="space-y-2.5">
                {runs.runs.map((run) => (
                  <li key={run.id} className="rounded-[10px] border border-line bg-surface-1 p-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          run.status === "WAITING_APPROVAL" ? "bg-amber" : "bg-accent animate-pulse-soft",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                        {run.intent?.rawInput ?? run.name}
                      </span>
                      <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{titleCase(run.status)}</Badge>
                      <Link href={`/runs/${run.id}`} className="text-[11px] text-mute hover:text-ink">
                        Inspect
                      </Link>
                    </div>
                    <Progress value={run.progress ?? 0} className="mt-2.5" />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Sparkles}
                title="No active runs"
                description="Give NEXUS an objective and it will plan, orchestrate agents and execute."
                action={
                  <Link href="/command">
                    <Button variant="primary" size="sm">
                      Open command
                    </Button>
                  </Link>
                }
              />
            )}
          </CardContent>
        </Card>

        {/* Approvals */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>What needs your attention</CardTitle>
              <p className="text-[11.5px] text-mute mt-1">Actions are never taken without your approval.</p>
            </div>
            <Link href="/approvals" className="text-[11.5px] text-accent-bright hover:underline">
              All
            </Link>
          </CardHeader>
          <CardContent className="pt-3">
            {approvals?.approvals?.length ? (
              <ul className="space-y-2">
                {approvals.approvals.slice(0, 4).map((approval) => (
                  <li key={approval.id}>
                    <Link
                      href="/approvals"
                      className="flex items-center gap-2.5 rounded-[10px] border border-amber/20 bg-amber/[0.04] px-3 py-2.5 hover:border-amber/35 transition-colors"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-amber" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{approval.title}</span>
                      <Badge tone={approval.permissionLevel === "HIGH_IMPACT" ? "danger" : "warning"}>
                        {approval.permissionLevel.replace("_", " ")}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={CheckCircle2} title="Nothing waiting on you" description="No approvals pending." />
            )}
          </CardContent>
        </Card>

        {/* Project health */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>Project health</CardTitle>
              <p className="text-[11.5px] text-mute mt-1">
                {atRisk.length ? `${atRisk.length} project(s) need attention` : "All projects nominal"}
              </p>
            </div>
            <Link href="/projects" className="text-[11.5px] text-accent-bright hover:underline">
              Projects
            </Link>
          </CardHeader>
          <CardContent className="pt-3">
            {projectsLoading ? (
              <LoadingRows rows={3} />
            ) : projects?.projects?.length ? (
              <ul className="space-y-2.5">
                {projects.projects.slice(0, 5).map((project) => (
                  <li key={project.id}>
                    <Link href={`/projects/${project.id}`} className="group block">
                      <div className="flex items-center gap-2.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: project.color }} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink group-hover:text-white">
                          {project.name}
                        </span>
                        <Badge tone={STATUS_TONE[project.health] ?? "neutral"}>{titleCase(project.health)}</Badge>
                        <span className="w-9 text-right text-[11px] text-mute">{project.progress}%</span>
                      </div>
                      <Progress value={project.progress} className="mt-2" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={FolderKanban} title="No projects" description="Create your first project." />
            )}
          </CardContent>
        </Card>

        {/* Deadlines */}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming deadlines</CardTitle>
            <p className="text-[11.5px] text-mute mt-1">Ordered by due date.</p>
          </CardHeader>
          <CardContent className="pt-3">
            {upcoming.length ? (
              <ul className="space-y-2">
                {upcoming.map((task) => {
                  const overdue = task.dueDate ? new Date(task.dueDate) < new Date() : false;
                  return (
                    <li key={task.id} className="flex items-center gap-2.5">
                      <CalendarClock className={cn("h-3.5 w-3.5 shrink-0", overdue ? "text-red" : "text-mute")} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-dim">{task.title}</span>
                      <span className={cn("text-[11px]", overdue ? "text-red" : "text-mute")}>
                        {relativeTime(task.dueDate)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={CalendarClock} title="No deadlines" description="Nothing scheduled yet." />
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card className="lg:col-span-1">
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>Recent activity</CardTitle>
            </div>
            <Link href="/activity" className="text-[11.5px] text-accent-bright hover:underline">
              Open
            </Link>
          </CardHeader>
          <CardContent className="pt-3">
            {activity?.activity?.length ? (
              <ul className="space-y-2.5">
                {activity.activity.slice(0, 7).map((item) => (
                  <li key={item.id} className="flex gap-2.5">
                    <Activity
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        item.status === "error"
                          ? "text-red"
                          : item.status === "warning"
                            ? "text-amber"
                            : item.status === "success"
                              ? "text-emerald"
                              : "text-mute",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-dim">{item.summary}</p>
                      <p className="text-[11px] text-mute">
                        {titleCase(item.kind)} · {relativeTime(item.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <LoadingRows rows={4} />
            )}
          </CardContent>
        </Card>

        {/* Memory */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>Memory updates</CardTitle>
              <p className="text-[11.5px] text-mute mt-1">What NEXUS chose to remember.</p>
            </div>
            <Link href="/settings#memory" className="text-[11.5px] text-accent-bright hover:underline">
              Manage
            </Link>
          </CardHeader>
          <CardContent className="pt-3">
            {memory?.memories?.length ? (
              <ul className="space-y-2.5">
                {memory.memories.slice(0, 5).map((item) => (
                  <li key={item.id} className="flex gap-2.5">
                    <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] leading-relaxed text-dim">{truncate(item.content, 100)}</p>
                      <p className="text-[11px] text-mute">
                        {titleCase(item.type)} · {relativeTime(item.updatedAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Brain} title="No memories yet" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recommended actions */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Recommended next actions</CardTitle>
          <p className="text-[11.5px] text-mute mt-1">Derived from live workspace state.</p>
        </CardHeader>
        <CardContent className="pt-3">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {(approvals?.approvals?.length ?? 0) > 0 ? (
              <Recommendation
                icon={ShieldCheck}
                title="Resolve pending approvals"
                detail={`${approvals!.approvals.length} action(s) are waiting for your decision.`}
                href="/approvals"
              />
            ) : null}
            {(tasks?.summary?.overdue ?? 0) > 0 ? (
              <Recommendation
                icon={AlertTriangle}
                title="Re-date overdue work"
                detail={`${tasks!.summary.overdue} task(s) are past their due date.`}
                href="/tasks?overdue=true"
              />
            ) : null}
            {atRisk.length ? (
              <Recommendation
                icon={TrendingUp}
                title="Review at-risk projects"
                detail={atRisk.map((p) => p.name).join(", ")}
                href={`/projects/${atRisk[0].id}`}
              />
            ) : null}
            <Recommendation
              icon={Command}
              title="Run a launch review"
              detail="Ask NEXUS to prepare or review a plan against this week's deadline."
              href="/command"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone: "accent" | "warning" | "success" | "neutral";
}) {
  const tones = {
    accent: "text-accent-bright",
    warning: "text-amber",
    success: "text-emerald",
    neutral: "text-mute",
  };
  return (
    <div className="panel px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5", tones[tone])} />
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-mute">{label}</span>
      </div>
      <p className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-ink">{value}</p>
      <p className="text-[11.5px] text-mute">{detail}</p>
    </div>
  );
}

function Recommendation({
  icon: Icon,
  title,
  detail,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-[12px] border border-line bg-surface-1 p-3.5 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-mute group-hover:text-accent-bright" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-mute">{detail}</p>
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-mute opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
