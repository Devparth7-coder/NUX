"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { relativeTime, titleCase } from "@/lib/utils";
import type { ProjectSummary } from "@/types/api";

export default function ProjectsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", description: "", objective: "" });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1") {
      setCreating(true);
    }
  }, []);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ projects: ProjectSummary[]; total: number }>("/api/projects?pageSize=50"),
  });

  async function create() {
    if (form.name.trim().length < 2) return;
    setBusy(true);
    try {
      await api.post("/api/projects", form);
      toast({ tone: "success", title: "Project created" });
      setCreating(false);
      setForm({ name: "", description: "", objective: "" });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (err) {
      toast({ tone: "error", title: "Could not create project", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-8 md:px-8">
      <PageHeader
        title="Projects"
        description="Intelligent environments: every project carries its own objective, health signals, knowledge, tasks and agent history."
        actions={
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New project
          </Button>
        }
      />

      <div className="mt-6">
        {isLoading ? (
          <LoadingRows rows={4} />
        ) : isError ? (
          <ErrorState
            description={error instanceof Error ? error.message : "Failed to load projects"}
            action={
              <Button variant="secondary" size="sm" onClick={() => void refetch()}>
                Retry
              </Button>
            }
          />
        ) : data?.projects?.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.projects.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`} className="group">
                <Card className="h-full transition-colors group-hover:border-line-strong">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: project.color }} />
                        <h3 className="text-[14px] font-medium text-ink group-hover:text-white">{project.name}</h3>
                      </div>
                      <Badge tone={STATUS_TONE[project.health] ?? "neutral"}>{titleCase(project.health)}</Badge>
                    </div>

                    <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-mute">
                      {project.objective ?? project.description ?? "No objective set."}
                    </p>

                    <div className="mt-4">
                      <div className="mb-1.5 flex items-center justify-between text-[11px] text-mute">
                        <span>Progress</span>
                        <span>{project.progress}%</span>
                      </div>
                      <Progress value={project.progress} />
                    </div>

                    <div className="mt-4 flex items-center gap-4 text-[11px] text-mute">
                      <span>{project.counts.tasks} tasks</span>
                      <span>{project.counts.documents} docs</span>
                      <span>{project.counts.done} done</span>
                      <span className="ml-auto">{relativeTime(project.updatedAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="Create a project to give NEXUS a place to plan, retrieve context and execute."
              action={
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                  Create project
                </Button>
              }
            />
          </Card>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="Create project" description="Projects are the environment NEXUS reasons inside.">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input id="project-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="NEXUS Launch" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-objective">Objective</Label>
              <Input
                id="project-objective"
                value={form.objective}
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
                placeholder="Launch publicly with an end-to-end demonstration"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What is this project for?"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="md" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={create} loading={busy} disabled={form.name.trim().length < 2}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Create project
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
