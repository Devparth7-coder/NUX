'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  ArrowUpRight,
  Brain,
  Clock,
  Command as CommandIcon,
  CornerDownLeft,
  Cpu,
  FolderKanban,
  Lightbulb,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Progress } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { cn, relativeTime, truncate } from '@/lib/utils';
import { ExecutionView } from './execution-view';

interface ProjectSummary {
  id: string;
  name: string;
  health: string;
  progress: number;
  deadline: string | null;
  _count: { tasks: number; documents: number };
}

interface MemorySummary {
  id: string;
  content: string;
  type: string;
  importance: number;
  updatedAt: string;
}

interface IntentSummary {
  id: string;
  objective: string;
  rawInput: string;
  status: string;
  createdAt: string;
}

const SUGGESTIONS = [
  'Prepare my project launch plan.',
  'Analyze this research paper.',
  'Find everything related to Project Atlas.',
  'Review my unfinished tasks.',
  'Prepare a presentation from these documents.',
  'Research competitors and summarize the opportunities.',
];

export function CommandCenter({ mode }: { mode: 'REAL' | 'DEMO' }) {
  const router = useRouter();
  const params = useSearchParams();
  const { push } = useToast();

  const [input, setInput] = React.useState('');
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const [intentId, setIntentId] = React.useState<string | null>(null);

  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [memories, setMemories] = React.useState<MemorySummary[]>([]);
  const [recent, setRecent] = React.useState<IntentSummary[]>([]);
  const [activeRuns, setActiveRuns] = React.useState<{ id: string; status: string; intent: { objective: string } | null; agent: { name: string } }[]>([]);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const load = React.useCallback(async () => {
    try {
      const [projectData, memoryData, intentData, runData] = await Promise.all([
        fetchJson<{ items: ProjectSummary[] }>('/api/projects'),
        fetchJson<{ items: MemorySummary[] }>('/api/memory'),
        fetchJson<{ items: IntentSummary[] }>('/api/intents?limit=6'),
        fetchJson<{ items: { id: string; status: string; intent: { objective: string } | null; agent: { name: string } }[] }>(
          '/api/agent-runs?limit=8',
        ),
      ]);
      setProjects(projectData.items);
      setMemories(memoryData.items.slice(0, 5));
      setRecent(intentData.items);
      setActiveRuns(
        runData.items.filter((r) => ['RUNNING', 'QUEUED', 'PLANNING', 'WAITING_APPROVAL'].includes(r.status)).slice(0, 4),
      );
    } catch {
      /* keep previous values */
    }
  }, []);

  React.useEffect(() => {
    void load();
    const id = setInterval(load, 12_000);
    return () => clearInterval(id);
  }, [load]);

  // Deep link from the command palette: /command?q=...
  React.useEffect(() => {
    const q = params.get('q');
    if (q) {
      setInput(q);
      setTimeout(() => void submit(q), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function submit(raw?: string) {
    const text = (raw ?? input).trim();
    if (text.length < 3 || running) return;
    setRunning(true);
    setIntentId(null);
    try {
      const data = await fetchJson<{ intentId: string }>('/api/command', {
        method: 'POST',
        body: JSON.stringify({ input: text, projectId }),
      });
      setIntentId(data.intentId);
      router.replace(`/runs/${data.intentId}`, { scroll: false });
    } catch (error) {
      push({
        title: 'Could not start the run',
        description: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-2xl border border-line bg-surface-1/60 p-6 shadow-panel backdrop-blur-2xl sm:p-10"
      >
        <div className="pointer-events-none absolute -right-32 -top-40 h-96 w-96 rounded-full bg-accent/12 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-80 w-80 rounded-full bg-violet/10 blur-[110px]" />

        <div className="relative">
          <div className="flex items-center gap-2">
            <CommandIcon className="h-3.5 w-3.5 text-accent-soft" />
            <span className="label">Command</span>
            {mode === 'DEMO' ? <Badge variant="warn">DEMO MODE</Badge> : <Badge variant="good">LIVE</Badge>}
          </div>

          <h1 className="mt-4 max-w-3xl text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">
            <span className="gradient-text">What do you want to accomplish?</span>
          </h1>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-muted">
            NEXUS will understand the situation, gather context, plan the work, orchestrate specialised agents, use
            tools, ask before anything sensitive, verify the result, and remember what mattered.
          </p>

          {/* Command input */}
          <div className="mt-7">
            <div
              className={cn(
                'group relative rounded-2xl border bg-surface-2/70 transition-all duration-300',
                'border-line hover:border-line-strong focus-within:border-accent/45 focus-within:shadow-[0_0_0_1px_rgba(61,126,255,0.25),0_0_40px_-12px_rgba(61,126,255,0.65)]',
              )}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                rows={2}
                placeholder="Tell NEXUS what you want to accomplish…"
                aria-label="Command input"
                className="w-full resize-none bg-transparent px-5 pb-3 pt-5 text-[17px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
              />

              <div className="flex flex-wrap items-center gap-2 border-t border-line-faint px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <span className="label mr-1 hidden sm:inline">Scope</span>
                  <button
                    onClick={() => setProjectId(null)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-2xs transition-colors',
                      projectId === null ? 'border-accent/40 bg-accent/10 text-accent-soft' : 'border-line text-ink-muted hover:text-ink',
                    )}
                  >
                    Whole workspace
                  </button>
                  {projects.slice(0, 3).map((project) => (
                    <button
                      key={project.id}
                      onClick={() => setProjectId(project.id === projectId ? null : project.id)}
                      className={cn(
                        'max-w-[140px] truncate rounded-md border px-2 py-1 text-2xs transition-colors',
                        projectId === project.id
                          ? 'border-accent/40 bg-accent/10 text-accent-soft'
                          : 'border-line text-ink-muted hover:text-ink',
                      )}
                    >
                      {project.name}
                    </button>
                  ))}
                </div>

                <span className="hidden items-center gap-1 text-2xs text-ink-faint sm:flex">
                  <CornerDownLeft className="h-3 w-3" /> to execute
                </span>

                <Button variant="primary" onClick={() => void submit()} loading={running} disabled={input.trim().length < 3}>
                  {!running ? <Zap className="h-4 w-4" /> : null}
                  {running ? 'Executing' : 'Execute'}
                </Button>
              </div>
            </div>

            {/* Suggestions */}
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    textareaRef.current?.focus();
                  }}
                  className="group rounded-full border border-line bg-surface-2/50 px-3 py-1.5 text-[12.5px] text-ink-muted transition-all hover:border-line-strong hover:bg-surface-3/60 hover:text-ink"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.section>

      {/* ── Live execution ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {intentId ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6"
          >
            <ExecutionView intentId={intentId} onClose={() => { setIntentId(null); setRunning(false); }} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ── Context rail ─────────────────────────────────────────────────── */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <Clock className="h-3.5 w-3.5 text-ink-faint" /> Recent intent
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {recent.length ? (
              recent.map((intent) => (
                <Link
                  key={intent.id}
                  href={`/runs/${intent.id}`}
                  className="group flex items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
                >
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{intent.objective}</span>
                    <span className="block text-2xs text-ink-faint">
                      {relativeTime(intent.createdAt)} · {intent.status.replace('_', ' ').toLowerCase()}
                    </span>
                  </span>
                </Link>
              ))
            ) : (
              <p className="px-2 py-4 text-[13px] text-ink-faint">No commands yet. The first one starts the pipeline.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <FolderKanban className="h-3.5 w-3.5 text-ink-faint" /> Projects
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {projects.length ? (
              projects.slice(0, 4).map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`} className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] text-ink">{project.name}</span>
                    <Badge
                      variant={
                        project.health === 'HEALTHY' ? 'good' : project.health === 'BLOCKED' ? 'bad' : project.health === 'AT_RISK' ? 'warn' : 'default'
                      }
                    >
                      {project.health.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={project.progress} className="flex-1" />
                    <span className="font-mono text-2xs text-ink-faint">{project.progress}%</span>
                  </div>
                  <p className="mt-1.5 text-2xs text-ink-faint">
                    {project._count.tasks} tasks · {project._count.documents} documents
                    {project.deadline ? ` · due ${relativeTime(project.deadline)}` : ''}
                  </p>
                </Link>
              ))
            ) : (
              <EmptyState title="No projects yet" description="Create a project to give NEXUS a domain to reason about." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <Brain className="h-3.5 w-3.5 text-ink-faint" /> Memory context
            </CardTitle>
            <Link href="/memory" className="text-2xs text-accent-soft hover:underline">
              Manage
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {memories.length ? (
              memories.map((memory) => (
                <div key={memory.id} className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="label">{memory.type.replace('_', ' ')}</span>
                    <span className="font-mono text-2xs text-ink-faint">{memory.importance}</span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{truncate(memory.content, 120)}</p>
                </div>
              ))
            ) : (
              <p className="px-2 py-4 text-[13px] text-ink-faint">NEXUS has not saved anything yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Active runs ──────────────────────────────────────────────────── */}
      {activeRuns.length ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <Cpu className="h-3.5 w-3.5 text-ink-faint" /> Active runs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeRuns.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.intent ? '' : ''}${run.id}`}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/40 px-3 py-2.5 transition-colors hover:bg-surface-3/50"
              >
                <Activity className="h-3.5 w-3.5 text-accent-soft" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{run.intent?.objective ?? 'Workflow run'}</span>
                  <span className="block text-2xs text-ink-faint">
                    {run.agent?.name ?? 'Agent'} · {run.status.replace('_', ' ')}
                  </span>
                </span>
                <Badge variant={run.status === 'WAITING_APPROVAL' ? 'warn' : 'accent'}>{run.status.replace('_', ' ')}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <p className="mt-6 flex items-center justify-center gap-2 text-center text-2xs text-ink-faint">
        <Lightbulb className="h-3 w-3" />
        Press <kbd className="rounded border border-line px-1.5 py-0.5 font-mono">⌘K</kbd> anywhere to search the
        workspace or jump to any command.
      </p>
    </div>
  );
}
