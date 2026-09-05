"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Workflow as WorkflowIcon, Plus, Play, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { relativeTime, titleCase } from "@/lib/utils";

type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  updatedAt: string;
  nodes: Array<{ id: string; type: string; label: string }>;
  edges: Array<{ id: string }>;
  runs: Array<{ id: string; status: string; createdAt: string }>;
};

export default function WorkflowsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", description: "" });
  const [busy, setBusy] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => api.get<{ workflows: WorkflowRow[] }>("/api/workflows"),
    refetchInterval: 15_000,
  });

  async function create() {
    if (form.name.trim().length < 3) return;
    try {
      const result = await api.post<{ workflow: { id: string } }>("/api/workflows", {
        name: form.name,
        description: form.description,
        status: "DRAFT",
        nodes: [
          { key: "trigger", type: "TRIGGER", label: "Trigger", config: { event: "manual" }, positionX: 40, positionY: 120 },
          { key: "plan", type: "AGENT", label: "Planning Agent", config: { agentKey: "planning" }, positionX: 300, positionY: 120 },
          { key: "output", type: "OUTPUT", label: "Output", config: {}, positionX: 560, positionY: 120 },
        ],
        edges: [
          { sourceKey: "trigger", targetKey: "plan" },
          { sourceKey: "plan", targetKey: "output" },
        ],
      });
      toast({ tone: "success", title: "Workflow created" });
      setCreating(false);
      setForm({ name: "", description: "" });
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      window.location.href = `/workflows/${result.workflow.id}`;
    } catch (err) {
      toast({ tone: "error", title: "Could not create workflow", body: err instanceof Error ? err.message : String(err) });
    }
  }

  async function run(id: string) {
    setBusy(id);
    try {
      const result = await api.post<{ runId: string }>(`/api/workflows/${id}/run`, { input: { query: "launch readiness" } });
      toast({ tone: "success", title: "Workflow queued", body: "Execution started in the background." });
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      window.location.href = `/workflows/${id}?run=${result.runId}`;
    } catch (err) {
      toast({ tone: "error", title: "Workflow rejected", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-8 md:px-8">
      <PageHeader
        title="Workflows"
        description="Saved, versioned, validated graphs of triggers, agents, tools, conditions, approvals and outputs — executed by the same engine that runs your intents."
        actions={
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New workflow
          </Button>
        }
      />

      <div className="mt-6">
        {isLoading ? (
          <LoadingRows rows={3} />
        ) : data?.workflows?.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.workflows.map((workflow) => (
              <Card key={workflow.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/workflows/${workflow.id}`} className="text-[13.5px] font-medium text-ink hover:text-white">
                        {workflow.name}
                      </Link>
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-mute">{workflow.description ?? "No description"}</p>
                    </div>
                    <Badge tone={workflow.status === "ACTIVE" ? "success" : "neutral"}>{titleCase(workflow.status)}</Badge>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {workflow.nodes.slice(0, 6).map((node) => (
                      <span key={node.id} className="rounded-md border border-line bg-surface-1 px-1.5 py-0.5 text-[10px] text-mute">
                        {node.type}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center gap-3 text-[11px] text-mute">
                    <span>v{workflow.version}</span>
                    <span>{workflow.nodes.length} nodes</span>
                    <span>{workflow.edges.length} edges</span>
                    <span className="ml-auto">{relativeTime(workflow.updatedAt)}</span>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void run(workflow.id)} loading={busy === workflow.id}>
                      {busy === workflow.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
                    </Button>
                    <Link href={`/workflows/${workflow.id}`}>
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    </Link>
                    {workflow.runs[0] ? (
                      <Badge tone={STATUS_TONE[workflow.runs[0].status] ?? "neutral"} className="ml-auto">
                        {titleCase(workflow.runs[0].status)}
                      </Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={WorkflowIcon}
              title="No workflows yet"
              description="Build a reusable execution graph once, then run it on demand."
              action={
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                  Create workflow
                </Button>
              }
            />
          </Card>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="Create workflow" description="Start from a trigger → agent → output skeleton and extend it in the builder.">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">Name</Label>
              <Input id="wf-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Launch readiness workflow" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-description">Description</Label>
              <Textarea id="wf-description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={create} disabled={form.name.trim().length < 3}>
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
