'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FolderKanban, Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState, Progress } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { relativeTime } from '@/lib/utils';

interface Project {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  status: string;
  health: string;
  healthScore: number;
  progress: number;
  priority: string;
  deadline: string | null;
  _count: { tasks: number; documents: number; agentRuns: number };
}

export function ProjectsView() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { push } = useToast();

  const [query, setQuery] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', description: '', objective: '', deadline: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => fetchJson<{ items: Project[] }>('/api/projects'),
  });

  React.useEffect(() => {
    if (params.get('new') === '1') setCreating(true);
  }, [params]);

  const projects = (data?.items ?? []).filter((p) =>
    !query ? true : `${p.name} ${p.description ?? ''} ${p.objective ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );

  async function create() {
    if (form.name.trim().length < 2) return;
    setSaving(true);
    try {
      await fetchJson('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          objective: form.objective || undefined,
          deadline: form.deadline || undefined,
        }),
      });
      push({ title: 'Project created', description: form.name, tone: 'success' });
      setCreating(false);
      setForm({ name: '', description: '', objective: '', deadline: '' });
      await qc.invalidateQueries({ queryKey: ['projects'] });
      router.replace('/projects');
    } catch (error) {
      push({ title: 'Could not create project', description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Projects</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">Intelligent environments</h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-muted">
            Each project carries its own objective, health signal, knowledge, work and activity. NEXUS reasons inside a
            project, not in a vacuum.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter projects" className="h-9 w-56 pl-9" />
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New project
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-48 rounded-xl" />
          ))}
        </div>
      ) : projects.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.2) }}
            >
              <Link href={`/projects/${project.id}`} className="block h-full">
                <Card interactive className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-semibold text-ink">{project.name}</h3>
                      <p className="mt-0.5 text-2xs text-ink-faint">{project.status.replace('_', ' ')}</p>
                    </div>
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

                  <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-ink-muted">
                    {project.objective ?? project.description ?? 'No objective defined yet.'}
                  </p>

                  <div className="mt-4 flex items-center gap-2.5">
                    <Progress
                      value={project.progress}
                      tone={project.health === 'BLOCKED' ? 'bad' : project.health === 'AT_RISK' ? 'warn' : project.progress === 100 ? 'good' : 'accent'}
                      className="flex-1"
                    />
                    <span className="font-mono text-2xs text-ink-faint">{project.progress}%</span>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-line-faint pt-3 text-2xs text-ink-faint">
                    <span>
                      {project._count.tasks} tasks · {project._count.documents} docs · {project._count.agentRuns} runs
                    </span>
                    <span className="flex items-center gap-1">
                      {project.deadline ? relativeTime(project.deadline) : 'No deadline'}
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={FolderKanban}
          title={query ? 'No projects match that filter' : 'No projects yet'}
          description="Projects give NEXUS a domain to reason about: objective, documents, tasks, knowledge and activity."
          action={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Create project
            </Button>
          }
        />
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create project"
        description="NEXUS will use this project as the context boundary for planning, retrieval and execution."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={create}>
              Create project
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label mb-1.5 block">Name</span>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Project Atlas" />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Objective</span>
            <Input
              value={form.objective}
              onChange={(e) => setForm({ ...form, objective: e.target.value })}
              placeholder="Ship the private beta to 50 design partners"
            />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Description</span>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Deadline</span>
            <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </label>
        </div>
      </Modal>
    </div>
  );
}
