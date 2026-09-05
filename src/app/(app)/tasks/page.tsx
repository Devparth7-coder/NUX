"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Plus, AlertTriangle, Filter } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, relativeTime, titleCase } from "@/lib/utils";
import type { TaskSummary, ProjectSummary } from "@/types/api";

const STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export default function TasksPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<string>("");
  const [projectId, setProjectId] = React.useState<string>("");
  const [overdue, setOverdue] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({
    title: "",
    description: "",
    priority: "MEDIUM",
    status: "TODO",
    projectId: "",
    dueDate: "",
  });

  React.useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") {
      setCreating(true);
    }
  }, []);

  const query = React.useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (projectId) params.set("projectId", projectId);
    if (overdue) params.set("overdue", "true");
    params.set("pageSize", "100");
    return params.toString();
  }, [status, projectId, overdue]);

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", query],
    queryFn: () =>
      api.get<{ tasks: TaskSummary[]; summary: { total: number; done: number; blocked: number; overdue: number } }>(
        `/api/tasks?${query}`,
      ),
  });

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ projects: ProjectSummary[] }>("/api/projects?pageSize=50"),
  });

  async function create() {
    try {
      await api.post("/api/tasks", {
        ...form,
        projectId: form.projectId || null,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      });
      toast({ tone: "success", title: "Task created" });
      setCreating(false);
      setForm({ title: "", description: "", priority: "MEDIUM", status: "TODO", projectId: "", dueDate: "" });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (err) {
      toast({ tone: "error", title: "Could not create task", body: err instanceof Error ? err.message : String(err) });
    }
  }

  async function update(taskId: string, patch: Record<string, unknown>) {
    await api.patch(`/api/tasks/${taskId}`, patch);
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  async function remove(taskId: string) {
    await api.delete(`/api/tasks/${taskId}`);
    toast({ tone: "info", title: "Task deleted" });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  const grouped = React.useMemo(() => {
    const map = new Map<string, TaskSummary[]>();
    for (const s of STATUSES) map.set(s, []);
    for (const task of data?.tasks ?? []) map.get(task.status)?.push(task);
    return map;
  }, [data]);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-8 md:px-8">
      <PageHeader
        title="Tasks"
        description="Every task records its source — you, an agent, or a workflow — and NEXUS flags overdue, blocked and dependency problems."
        actions={
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New task
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-mute">
          <Filter className="h-3.5 w-3.5" /> Filters
        </span>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Filter by project">
          <option value="">All projects</option>
          {projects?.projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 rounded-[10px] border border-line bg-surface-1 px-3 py-2 text-[12px] text-dim">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} className="accent-[#3b82f6]" />
          Overdue only
        </label>
        {data?.summary ? (
          <span className="ml-auto text-[11.5px] text-mute">
            {data.summary.total} total · {data.summary.done} done · {data.summary.overdue} overdue · {data.summary.blocked} blocked
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="mt-6">
          <LoadingRows rows={5} />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATUSES.map((column) => (
            <Card key={column} className="flex flex-col">
              <CardHeader className="flex items-center justify-between">
                <CardTitle>{titleCase(column)}</CardTitle>
                <Badge tone={STATUS_TONE[column] === "success" ? "success" : column === "BLOCKED" ? "warning" : "neutral"}>
                  {grouped.get(column)?.length ?? 0}
                </Badge>
              </CardHeader>
              <CardContent className="flex-1 space-y-2 pt-3">
                {(grouped.get(column) ?? []).map((task) => {
                  const isOverdue = task.dueDate && task.status !== "DONE" && new Date(task.dueDate) < new Date();
                  return (
                    <div key={task.id} className="rounded-[10px] border border-line bg-surface-1 p-3">
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                            task.priority === "URGENT"
                              ? "bg-red"
                              : task.priority === "HIGH"
                                ? "bg-amber"
                                : task.priority === "MEDIUM"
                                  ? "bg-accent"
                                  : "bg-mute",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-[12.5px] leading-snug text-ink", task.status === "DONE" && "text-mute line-through")}>
                            {task.title}
                          </p>
                          {task.description ? (
                            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-mute">{task.description}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-mute">
                            {task.project ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ background: task.project.color }} />
                                {task.project.name}
                              </span>
                            ) : null}
                            {task.dueDate ? (
                              <span className={cn(isOverdue ? "text-red" : "")}>
                                {isOverdue ? <AlertTriangle className="mr-1 inline h-2.5 w-2.5" /> : null}
                                {relativeTime(task.dueDate)}
                              </span>
                            ) : null}
                            {task.createdByAgent ? <span className="text-violet">agent</span> : null}
                          </div>
                          {task.blockedReason ? (
                            <p className="mt-1.5 rounded border border-amber/25 bg-amber/[0.06] px-2 py-1 text-[10.5px] text-amber">
                              {task.blockedReason}
                            </p>
                          ) : null}
                          <div className="mt-2.5 flex items-center gap-1.5">
                            <Select
                              value={task.status}
                              onChange={(e) => void update(task.id, { status: e.target.value })}
                              className="h-7 px-2 py-0 text-[11px]"
                              aria-label={`Status for ${task.title}`}
                            >
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {titleCase(s)}
                                </option>
                              ))}
                            </Select>
                            <Select
                              value={task.priority}
                              onChange={(e) => void update(task.id, { priority: e.target.value })}
                              className="h-7 px-2 py-0 text-[11px]"
                              aria-label={`Priority for ${task.title}`}
                            >
                              {PRIORITIES.map((p) => (
                                <option key={p} value={p}>
                                  {titleCase(p)}
                                </option>
                              ))}
                            </Select>
                            <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-[11px]" onClick={() => void remove(task.id)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!(grouped.get(column) ?? []).length ? (
                  <p className="py-6 text-center text-[11.5px] text-mute">Nothing here</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="Create task" description="Tasks can also be generated by NEXUS agents from an objective.">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input id="task-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Finalise the launch brief" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-description">Description</Label>
              <Textarea id="task-description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="task-status">Status</Label>
                <Select id="task-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-priority">Priority</Label>
                <Select id="task-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {titleCase(p)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-due">Due date</Label>
                <Input id="task-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-project">Project</Label>
              <Select id="task-project" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">No project</option>
                {projects?.projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={create} disabled={form.title.trim().length < 3}>
                <CheckSquare className="h-3.5 w-3.5" /> Create task
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
