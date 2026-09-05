"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Brain,
  CalendarClock,
  CheckCircle2,
  FileText,
  ListChecks,
  Target,
  TrendingUp,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingRows } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { cn, formatDate, relativeTime, titleCase } from "@/lib/utils";
import type { TaskSummary, ActivitySummary } from "@/types/api";

type ProjectDetail = {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    objective: string | null;
    status: string;
    health: string;
    healthReason: string | null;
    progress: number;
    color: string;
    targetDate: string | null;
    createdAt: string;
    updatedAt: string;
  };
  intelligence: {
    openTasks: number;
    doneTasks: number;
    overdueTasks: number;
    blockedTasks: number;
    daysToDeadline: number | null;
    documents: number;
    knowledgeItems: number;
    lastRunAt: string | null;
  };
  tasks: TaskSummary[];
  documents: Array<{ id: string; title: string; status: string; chunkCount: number; createdAt: string }>;
  knowledge: Array<{ id: string; label: string; kind: string; content: string }>;
  milestones: Array<{ id: string; title: string; dueDate: string | null; completedAt: string | null }>;
  runs: Array<{ id: string; key: string; name: string; status: string; createdAt: string; latencyMs: number | null }>;
  artifacts: Array<{ id: string; title: string; type: string; createdAt: string }>;
};

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${id}`),
    refetchInterval: 20_000,
  });

  async function setTaskStatus(taskId: string, status: string) {
    await api.patch(`/api/tasks/${taskId}`, { status });
    toast({ tone: "success", title: "Task updated" });
    void queryClient.invalidateQueries({ queryKey: ["project", id] });
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8">
        <LoadingRows rows={6} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-[1240px] px-5 py-8 md:px-8">
        <Card>
          <ErrorState description={error instanceof Error ? error.message : "Failed to load project"} />
        </Card>
      </div>
    );
  }

  const { project, intelligence } = data;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-8 md:px-8">
      <PageHeader
        title={project.name}
        description={project.objective ?? project.description ?? undefined}
        actions={
          <>
            <Link href="/documents">
              <Button variant="secondary" size="md">
                <Upload className="h-3.5 w-3.5" /> Add documents
              </Button>
            </Link>
            <Link href={`/command`}>
              <Button variant="primary" size="md">
                Run NEXUS on this project
              </Button>
            </Link>
          </>
        }
      />

      {/* Intelligence strip */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Signal
          icon={Target}
          label="Objective"
          value={project.objective ? truncateObjective(project.objective) : "Not set"}
          tone="accent"
        />
        <Signal
          icon={TrendingUp}
          label="Health"
          value={titleCase(project.health)}
          detail={project.healthReason ?? undefined}
          tone={project.health === "HEALTHY" ? "success" : project.health === "BLOCKED" ? "danger" : "warning"}
        />
        <Signal
          icon={CalendarClock}
          label="Deadline"
          value={project.targetDate ? formatDate(project.targetDate) : "None"}
          detail={intelligence.daysToDeadline !== null ? `${intelligence.daysToDeadline} day(s) out` : undefined}
          tone={intelligence.daysToDeadline !== null && intelligence.daysToDeadline <= 2 ? "warning" : "neutral"}
        />
        <Signal
          icon={CheckCircle2}
          label="Completion"
          value={`${project.progress}%`}
          detail={`${intelligence.doneTasks} done · ${intelligence.openTasks} open`}
          tone="success"
        />
      </div>

      {project.progress !== undefined ? (
        <div className="mt-4">
          <Progress value={project.progress} />
        </div>
      ) : null}

      {(intelligence.overdueTasks > 0 || intelligence.blockedTasks > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {intelligence.overdueTasks > 0 ? (
            <Badge tone="danger">
              <AlertTriangle className="h-3 w-3" /> {intelligence.overdueTasks} overdue
            </Badge>
          ) : null}
          {intelligence.blockedTasks > 0 ? <Badge tone="warning">{intelligence.blockedTasks} blocked</Badge> : null}
        </div>
      )}

      <Tabs defaultValue="work" className="mt-6">
        <TabsList>
          <TabsTrigger value="work">Work</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="runs">Agent runs</TabsTrigger>
        </TabsList>

        <TabsContent value="work" className="mt-4 space-y-5">
          {data.milestones.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Milestones</CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                <ol className="space-y-2">
                  {data.milestones.map((milestone, index) => (
                    <li key={milestone.id} className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                          milestone.completedAt ? "border-emerald/40 bg-emerald/10 text-emerald" : "border-line text-mute",
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="flex-1 text-[12.5px] text-dim">{milestone.title}</span>
                      <span className="text-[11px] text-mute">
                        {milestone.completedAt ? "Completed" : formatDate(milestone.dueDate)}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle>Tasks</CardTitle>
                <p className="text-[11.5px] text-mute mt-1">
                  {data.tasks.length} task(s) · {intelligence.openTasks} open
                </p>
              </div>
              <Link href={`/tasks?projectId=${project.id}`}>
                <Button variant="ghost" size="sm">
                  <ListChecks className="h-3.5 w-3.5" /> Open in tasks
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="pt-2">
              {data.tasks.length ? (
                <ul className="divide-y divide-line">
                  {data.tasks.map((task) => (
                    <li key={task.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          task.status === "DONE"
                            ? "bg-emerald"
                            : task.status === "BLOCKED"
                              ? "bg-amber"
                              : task.priority === "URGENT"
                                ? "bg-red"
                                : "bg-mute",
                        )}
                      />
                      <span className={cn("min-w-0 flex-1 text-[12.5px]", task.status === "DONE" ? "text-mute line-through" : "text-ink")}>
                        {task.title}
                      </span>
                      {task.dueDate ? (
                        <span
                          className={cn(
                            "text-[11px]",
                            task.status !== "DONE" && new Date(task.dueDate) < new Date() ? "text-red" : "text-mute",
                          )}
                        >
                          {relativeTime(task.dueDate)}
                        </span>
                      ) : null}
                      <Badge tone={STATUS_TONE[task.priority] === "danger" ? "danger" : "neutral"}>{titleCase(task.priority)}</Badge>
                      <select
                        value={task.status}
                        onChange={(e) => void setTaskStatus(task.id, e.target.value)}
                        className="rounded-lg border border-line bg-surface-1 px-2 py-1 text-[11.5px] text-dim outline-none focus:border-accent/50"
                        aria-label={`Status for ${task.title}`}
                      >
                        <option value="TODO">TODO</option>
                        <option value="IN_PROGRESS">IN PROGRESS</option>
                        <option value="BLOCKED">BLOCKED</option>
                        <option value="DONE">DONE</option>
                      </select>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={ListChecks} title="No tasks yet" description="NEXUS can generate tasks from an objective." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="knowledge" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Knowledge</CardTitle>
              <p className="text-[11.5px] text-mute mt-1">{data.knowledge.length} item(s) linked to this project.</p>
            </CardHeader>
            <CardContent className="pt-3">
              {data.knowledge.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {data.knowledge.map((item) => (
                    <div key={item.id} className="rounded-[10px] border border-line bg-surface-1 p-3.5">
                      <div className="flex items-center gap-2">
                        <Brain className="h-3.5 w-3.5 text-violet" />
                        <span className="text-[12.5px] font-medium text-ink">{item.label}</span>
                        <Badge tone="violet" className="ml-auto">
                          {titleCase(item.kind)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-[11.5px] leading-relaxed text-mute">{item.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Brain} title="No knowledge yet" description="Ingest documents to build project knowledge." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {data.documents.length ? (
                <ul className="space-y-2">
                  {data.documents.map((doc) => (
                    <li key={doc.id}>
                      <Link
                        href={`/documents?doc=${doc.id}`}
                        className="flex items-center gap-3 rounded-[10px] border border-line bg-surface-1 px-3 py-2.5 hover:border-line-strong transition-colors"
                      >
                        <FileText className="h-3.5 w-3.5 text-mute" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{doc.title}</span>
                        <span className="text-[11px] text-mute">{doc.chunkCount} chunks</span>
                        <Badge tone={doc.status === "INDEXED" ? "success" : "warning"}>{titleCase(doc.status)}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={FileText} title="No documents" description="Upload PDF, DOCX, TXT, MD or CSV files." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Agent runs</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {data.runs.length ? (
                <ul className="space-y-2">
                  {data.runs.map((run) => (
                    <li key={run.id}>
                      <Link
                        href={`/runs/${run.id}`}
                        className="flex items-center gap-3 rounded-[10px] border border-line bg-surface-1 px-3 py-2.5 hover:border-line-strong transition-colors"
                      >
                        <Activity className="h-3.5 w-3.5 text-mute" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{run.name}</span>
                        <span className="text-[11px] text-mute">{relativeTime(run.createdAt)}</span>
                        <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{titleCase(run.status)}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={Activity} title="No agent runs yet" />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Signal({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail?: string;
  tone: "accent" | "success" | "warning" | "danger" | "neutral";
}) {
  const tones = {
    accent: "text-accent-bright",
    success: "text-emerald",
    warning: "text-amber",
    danger: "text-red",
    neutral: "text-mute",
  };
  return (
    <div className="panel px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5", tones[tone])} />
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-mute">{label}</span>
      </div>
      <p className="mt-2 text-[13.5px] font-medium text-ink">{value}</p>
      {detail ? <p className="text-[11.5px] text-mute">{detail}</p> : null}
    </div>
  );
}

function truncateObjective(value: string) {
  return value.length > 48 ? `${value.slice(0, 48)}…` : value;
}
