import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Brain,
  CalendarClock,
  CheckCircle2,
  Cpu,
  FileText,
  FolderKanban,
  LayoutGrid,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Progress } from '@/components/ui/misc';
import { ApprovalCard } from '@/features/approvals/approval-card';
import { StatCard } from '@/features/home/stat-card';
import { cn, relativeTime, truncate } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home · NEXUS' };

export default async function HomePage() {
  const user = await requirePageUser();

  const [projects, tasks, pendingApprovals, activeRuns, recentActivity, memories, documents, recentIntents] =
    await Promise.all([
      prisma.project.findMany({
        where: { workspaceId: user.workspaceId },
        orderBy: [{ health: 'asc' }, { updatedAt: 'desc' }],
        take: 6,
        include: { _count: { select: { tasks: true, documents: true } } },
      }),
      prisma.task.findMany({
        where: { workspaceId: user.workspaceId, status: { not: 'DONE' } },
        orderBy: [{ deadline: 'asc' }],
        take: 8,
        include: { project: { select: { id: true, name: true } } },
      }),
      prisma.approval.findMany({
        where: { OR: [{ requestedById: user.id }, { intent: { userId: user.id } }], status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      prisma.agentRun.findMany({
        where: { workspaceId: user.workspaceId, status: { in: ['RUNNING', 'QUEUED', 'PLANNING', 'WAITING_APPROVAL'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { agent: { select: { name: true } }, intent: { select: { objective: true } } },
      }),
      prisma.activity.findMany({
        where: { workspaceId: user.workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { project: { select: { id: true, name: true } } },
      }),
      prisma.memory.findMany({
        where: { workspaceId: user.workspaceId, enabled: true },
        orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
        take: 4,
      }),
      prisma.document.count({ where: { workspaceId: user.workspaceId, status: 'INDEXED' } }),
      prisma.intent.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 3 }),
    ]);

  const now = Date.now();
  const overdue = tasks.filter((t) => t.deadline && t.deadline.getTime() < now);
  const blocking = tasks.filter((t) => t.status === 'BLOCKED');
  const atRisk = projects.filter((p) => p.health === 'AT_RISK' || p.health === 'BLOCKED');

  const recommendations: { title: string; detail: string; href: string }[] = [];
  if (pendingApprovals.length) {
    recommendations.push({
      title: `${pendingApprovals.length} action${pendingApprovals.length === 1 ? '' : 's'} waiting for your approval`,
      detail: 'NEXUS has paused execution until you decide.',
      href: '/approvals',
    });
  }
  if (overdue.length) {
    recommendations.push({
      title: `${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`,
      detail: `Starting with "${overdue[0]!.title}". Reschedule or complete it to restore the plan.`,
      href: '/tasks',
    });
  }
  if (blocking.length) {
    recommendations.push({
      title: `${blocking.length} blocked task${blocking.length === 1 ? '' : 's'}`,
      detail: 'Blocked work gates everything downstream. Resolve the dependency first.',
      href: '/tasks',
    });
  }
  if (atRisk.length) {
    recommendations.push({
      title: `${atRisk.length} project${atRisk.length === 1 ? '' : 's'} need attention`,
      detail: `Health signals: ${atRisk.map((p) => `${p.name} (${p.health.replace('_', ' ')})`).join(', ')}.`,
      href: `/projects/${atRisk[0]!.id}`,
    });
  }
  if (!recommendations.length) {
    recommendations.push({
      title: 'Nothing needs your attention',
      detail: 'Tell NEXUS what to accomplish next — it will plan and execute.',
      href: '/command',
    });
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Home</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[32px]">
            {greeting}, {user.name.split(' ')[0]}.
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
            {activeRuns.length
              ? `NEXUS is working on ${activeRuns.length} run${activeRuns.length === 1 ? '' : 's'}.`
              : 'NEXUS is idle and ready.'}
            {pendingApprovals.length ? ` ${pendingApprovals.length} action(s) need your approval.` : ''}
          </p>
        </div>
        <Link
          href="/command"
          className="group inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-[0_8px_24px_-10px_rgba(61,126,255,0.9)] transition-all hover:bg-accent-soft"
        >
          <Sparkles className="h-4 w-4" />
          New command
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </header>

      {/* ── Top stats ──────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FolderKanban} label="Active projects" value={projects.length} detail={`${atRisk.length} need attention`} tone={atRisk.length ? 'warn' : 'default'} />
        <StatCard icon={LayoutGrid} label="Open tasks" value={tasks.length} detail={`${overdue.length} overdue`} tone={overdue.length ? 'bad' : 'default'} />
        <StatCard icon={FileText} label="Indexed documents" value={documents} detail="Available to agents" />
        <StatCard
          icon={ShieldCheck}
          label="Pending approvals"
          value={pendingApprovals.length}
          detail={pendingApprovals.length ? 'Execution paused' : 'Nothing waiting'}
          tone={pendingApprovals.length ? 'warn' : 'good'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── What needs attention ─────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <TrendingUp className="h-3.5 w-3.5 text-accent-soft" /> What needs your attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recommendations.map((rec) => (
              <Link
                key={rec.title}
                href={rec.href}
                className="group flex items-start gap-3 rounded-xl border border-line bg-surface-2/40 p-3.5 transition-all hover:border-line-strong hover:bg-surface-3/50"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_rgba(61,126,255,0.8)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-ink">{rec.title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-muted">{rec.detail}</span>
                </span>
                <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent-soft" />
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* ── Active runs ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <Cpu className="h-3.5 w-3.5 text-accent-soft" /> What NEXUS is working on
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeRuns.length ? (
              <div className="space-y-2">
                {activeRuns.map((run) => (
                  <Link
                    key={run.id}
                    href={`/runs/${run.intentId ?? ''}`}
                    className="block rounded-lg border border-line bg-surface-2/40 p-3 transition-colors hover:bg-surface-3/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent" />
                      <span className="truncate text-[13px] text-ink">{run.intent?.objective ?? 'Workflow run'}</span>
                    </div>
                    <p className="mt-1 text-2xs text-ink-faint">
                      {run.agent?.name} · {run.status.replace('_', ' ').toLowerCase()}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Cpu}
                title="No active runs"
                description="Execute a command and the pipeline will appear here in real time."
                action={
                  <Link href="/command" className="text-[13px] text-accent-soft hover:underline">
                    Open Command →
                  </Link>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Approvals ──────────────────────────────────────────────────── */}
      {pendingApprovals.length ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-warn" />
            <h2 className="text-[15px] font-semibold text-ink">Approvals required</h2>
            <Badge variant="warn">{pendingApprovals.length}</Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {pendingApprovals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={{
                  id: approval.id,
                  title: approval.title,
                  description: approval.description,
                  whatWillHappen: approval.whatWillHappen,
                  whyNeeded: approval.whyNeeded,
                  toolKey: approval.toolKey,
                  toolArguments: approval.toolArguments,
                  affectedData: approval.affectedData,
                  permission: approval.permission,
                  riskLevel: approval.riskLevel,
                  status: approval.status,
                  createdAt: approval.createdAt.toISOString(),
                }}
                compact
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Project health ───────────────────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <FolderKanban className="h-3.5 w-3.5 text-ink-faint" /> Project health
            </CardTitle>
            <Link href="/projects" className="text-2xs text-accent-soft hover:underline">
              All projects
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {projects.length ? (
              projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="block rounded-lg border border-line bg-surface-2/40 p-3 transition-colors hover:bg-surface-3/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[13.5px] font-medium text-ink">{project.name}</span>
                    <Badge
                      variant={
                        project.health === 'HEALTHY'
                          ? 'good'
                          : project.health === 'BLOCKED'
                            ? 'bad'
                            : project.health === 'AT_RISK'
                              ? 'warn'
                              : 'default'
                      }
                    >
                      {project.health.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <Progress
                      value={project.progress}
                      tone={project.health === 'BLOCKED' ? 'bad' : project.health === 'AT_RISK' ? 'warn' : project.progress === 100 ? 'good' : 'accent'}
                      className="flex-1"
                    />
                    <span className="font-mono text-2xs text-ink-faint">{project.progress}%</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-faint">
                    <span>{project._count.tasks} tasks</span>
                    <span>{project._count.documents} documents</span>
                    {project.deadline ? (
                      <span className="flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        {relativeTime(project.deadline)}
                      </span>
                    ) : null}
                    <span className="ml-auto">health score {project.healthScore}</span>
                  </div>
                </Link>
              ))
            ) : (
              <EmptyState icon={FolderKanban} title="No projects yet" description="Projects give NEXUS a domain to reason about." />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* ── Upcoming deadlines ─────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <CalendarClock className="h-3.5 w-3.5 text-ink-faint" /> Upcoming deadlines
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tasks.filter((t) => t.deadline).length ? (
                tasks
                  .filter((t) => t.deadline)
                  .slice(0, 5)
                  .map((task) => {
                    const late = task.deadline!.getTime() < now;
                    return (
                      <Link
                        key={task.id}
                        href="/tasks"
                        className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
                      >
                        <span
                          className={cn(
                            'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                            late ? 'bg-bad' : task.priority === 'URGENT' || task.priority === 'HIGH' ? 'bg-warn' : 'bg-accent',
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink">{task.title}</span>
                          <span className="block text-2xs text-ink-faint">
                            {task.project?.name ?? 'No project'} · {relativeTime(task.deadline)}
                          </span>
                        </span>
                      </Link>
                    );
                  })
              ) : (
                <p className="px-2 py-3 text-[13px] text-ink-faint">No dated tasks.</p>
              )}
            </CardContent>
          </Card>

          {/* ── Memory ─────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[14px]">
                <Brain className="h-3.5 w-3.5 text-violet-soft" /> Memory
              </CardTitle>
              <Link href="/memory" className="text-2xs text-accent-soft hover:underline">
                Manage
              </Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {memories.length ? (
                memories.map((memory) => (
                  <div key={memory.id} className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="label">{memory.type.replace('_', ' ')}</span>
                      <span className="font-mono text-2xs text-ink-faint">{memory.importance}</span>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{truncate(memory.content, 110)}</p>
                  </div>
                ))
              ) : (
                <p className="px-2 py-3 text-[13px] text-ink-faint">No memories saved yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Recent activity ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[14px]">
            <Activity className="h-3.5 w-3.5 text-ink-faint" /> Recent activity
          </CardTitle>
          <Link href="/activity" className="text-2xs text-accent-soft hover:underline">
            Activity center
          </Link>
        </CardHeader>
        <CardContent>
          {recentActivity.length ? (
            <div className="space-y-1">
              {recentActivity.map((item) => (
                <div key={item.id} className="flex items-start gap-3 rounded-lg px-2 py-2">
                  <span
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      item.severity === 'ERROR'
                        ? 'bg-bad'
                        : item.severity === 'WARNING'
                          ? 'bg-warn'
                          : item.severity === 'SUCCESS'
                            ? 'bg-good'
                            : 'bg-ink-faint',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-ink">{item.action}</span>
                    <span className="block text-2xs leading-relaxed text-ink-faint">{truncate(item.summary, 110)}</span>
                  </span>
                  <span className="shrink-0 text-2xs text-ink-faint">{relativeTime(item.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Activity} title="No activity yet" description="Every agent run, tool call and approval is recorded here." />
          )}
        </CardContent>
      </Card>

      {recentIntents.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <CheckCircle2 className="h-3.5 w-3.5 text-ink-faint" /> Recent commands
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {recentIntents.map((intent) => (
              <Link
                key={intent.id}
                href={`/runs/${intent.id}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{intent.objective}</span>
                <Badge variant={intent.status === 'COMPLETED' ? 'good' : intent.status === 'FAILED' ? 'bad' : intent.status === 'WAITING_APPROVAL' ? 'warn' : 'default'}>
                  {intent.status.replace('_', ' ')}
                </Badge>
                <span className="shrink-0 text-2xs text-ink-faint">{relativeTime(intent.createdAt)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
