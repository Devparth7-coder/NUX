'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CalendarClock, Check, Inbox, LayoutGrid, Link2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { cn, relativeTime } from '@/lib/utils';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  assignee: string | null;
  source: string;
  createdByAgent: string | null;
  projectId: string | null;
  project: { id: string; name: string } | null;
  dependencies: { dependsOn: { id: string; title: string; status: string } }[];
}

const COLUMNS: { id: string; label: string }[] = [
  { id: 'TODO', label: 'To do' },
  { id: 'IN_PROGRESS', label: 'In progress' },
  { id: 'BLOCKED', label: 'Blocked' },
  { id: 'DONE', label: 'Done' },
];

export function TasksView() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [projectFilter, setProjectFilter] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ title: '', description: '', priority: 'MEDIUM', deadline: '', assignee: '', projectId: '' });

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => fetchJson<{ items: { id: string; name: string }[] }>('/api/projects'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', projectFilter],
    queryFn: () => fetchJson<{ items: Task[] }>(`/api/tasks${projectFilter ? `?projectId=${projectFilter}` : ''}`),
  });

  const tasks = data?.items ?? [];
  const overdue = tasks.filter((t) => t.deadline && new Date(t.deadline).getTime() < Date.now() && t.status !== 'DONE');
  const dependencyIssues = tasks.filter((t) => t.status === 'DONE' && t.dependencies.some((d) => d.dependsOn.status !== 'DONE'));

  async function create() {
    if (form.title.trim().length < 2) return;
    setSaving(true);
    try {
      await fetchJson('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          priority: form.priority,
          deadline: form.deadline || null,
          assignee: form.assignee || null,
          projectId: form.projectId || null,
        }),
      });
      push({ title: 'Task created', description: form.title, tone: 'success' });
      setCreating(false);
      setForm({ title: '', description: '', priority: 'MEDIUM', deadline: '', assignee: '', projectId: '' });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (error) {
      push({ title: 'Could not create task', description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function update(id: string, patch: Partial<Task>) {
    await fetchJson(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    await qc.invalidateQueries({ queryKey: ['tasks'] });
  }

  async function remove(id: string, title: string) {
    await fetchJson(`/api/tasks/${id}`, { method: 'DELETE' });
    push({ title: 'Task deleted', description: title, tone: 'info' });
    await qc.invalidateQueries({ queryKey: ['tasks'] });
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Tasks</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">Work NEXUS can act on</h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-muted">
            Every task is real workspace state. Agents create and update tasks through the tool registry, with the same
            permission checks a human action would face.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="h-9 w-52">
            <option value="">All projects</option>
            {(projectsData?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New task
          </Button>
        </div>
      </header>

      {/* Detected issues */}
      {(overdue.length > 0 || dependencyIssues.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {overdue.length ? (
            <Card className="border-bad/25 bg-bad/[0.03]">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
                <div>
                  <p className="text-[13.5px] font-medium text-ink">{overdue.length} overdue task(s)</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
                    {overdue.slice(0, 2).map((t) => t.title).join(', ')}
                    {overdue.length > 2 ? ` and ${overdue.length - 2} more` : ''}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}
          {dependencyIssues.length ? (
            <Card className="border-warn/25 bg-warn/[0.03]">
              <CardContent className="flex items-start gap-3 p-4">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                <div>
                  <p className="text-[13.5px] font-medium text-ink">{dependencyIssues.length} dependency conflict(s)</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
                    Marked done while a blocking dependency is still open.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-64 rounded-xl" />
          ))}
        </div>
      ) : tasks.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => {
            const items = tasks.filter((t) => t.status === column.id);
            return (
              <Card key={column.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-[13px]">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        column.id === 'DONE'
                          ? 'bg-good'
                          : column.id === 'BLOCKED'
                            ? 'bg-bad'
                            : column.id === 'IN_PROGRESS'
                              ? 'bg-accent'
                              : 'bg-ink-faint',
                      )}
                    />
                    {column.label}
                    <span className="ml-auto font-mono text-2xs text-ink-faint">{items.length}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-2">
                  <AnimatePresence initial={false}>
                    {items.map((task) => {
                      const late = task.deadline && new Date(task.deadline).getTime() < Date.now() && task.status !== 'DONE';
                      return (
                        <motion.div
                          key={task.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          className="group rounded-lg border border-line bg-surface-2/50 p-3 transition-colors hover:border-line-strong"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn('text-[13px] leading-snug text-ink', task.status === 'DONE' && 'line-through opacity-60')}>
                              {task.title}
                            </p>
                            <button
                              onClick={() => void remove(task.id, task.title)}
                              className="opacity-0 transition-opacity group-hover:opacity-100"
                              aria-label="Delete task"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-ink-faint hover:text-bad" />
                            </button>
                          </div>

                          {task.description ? (
                            <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-ink-faint">{task.description}</p>
                          ) : null}

                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <Badge variant={task.priority === 'URGENT' ? 'bad' : task.priority === 'HIGH' ? 'warn' : 'outline'}>
                              {task.priority}
                            </Badge>
                            {task.deadline ? (
                              <Badge variant={late ? 'bad' : 'default'}>
                                <CalendarClock className="mr-1 h-3 w-3" />
                                {relativeTime(task.deadline)}
                              </Badge>
                            ) : null}
                            {task.createdByAgent ? <Badge variant="violet">agent · {task.createdByAgent}</Badge> : null}
                          </div>

                          {task.dependencies.length ? (
                            <p className="mt-2 flex items-center gap-1 text-2xs text-ink-faint">
                              <Link2 className="h-3 w-3" />
                              blocked by {task.dependencies.map((d) => d.dependsOn.title).join(', ')}
                            </p>
                          ) : null}

                          {task.project ? <p className="mt-1.5 text-2xs text-ink-faint">{task.project.name}</p> : null}

                          <div className="mt-2.5 flex gap-1.5 border-t border-line-faint pt-2.5">
                            {task.status !== 'DONE' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 flex-1 px-2 text-2xs"
                                onClick={() => void update(task.id, { status: task.status === 'TODO' ? 'IN_PROGRESS' : 'DONE' })}
                              >
                                {task.status === 'TODO' ? (
                                  <>
                                    <Inbox className="h-3 w-3" /> Start
                                  </>
                                ) : (
                                  <>
                                    <Check className="h-3 w-3" /> Complete
                                  </>
                                )}
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 flex-1 px-2 text-2xs"
                                onClick={() => void update(task.id, { status: 'TODO' })}
                              >
                                Reopen
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-2xs"
                              onClick={() => void update(task.id, { status: task.status === 'BLOCKED' ? 'TODO' : 'BLOCKED' })}
                            >
                              {task.status === 'BLOCKED' ? 'Unblock' : 'Block'}
                            </Button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                  {!items.length ? <p className="py-3 text-center text-2xs text-ink-faint">Nothing here</p> : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={LayoutGrid}
          title="No tasks yet"
          description="Create a task, or run a command and let NEXUS generate the plan."
          action={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New task
            </Button>
          }
        />
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create task"
        description="Tasks are real workspace state and immediately visible to agents."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={create}>
              Create task
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label mb-1.5 block">Title</span>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Finalize landing page" />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">Description</span>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label mb-1.5 block">Priority</span>
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </Select>
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Deadline</span>
              <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label mb-1.5 block">Assignee</span>
              <Input value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} placeholder="Unassigned" />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Project</span>
              <Select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">No project</option>
                {(projectsData?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
