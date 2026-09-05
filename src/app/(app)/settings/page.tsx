"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings as SettingsIcon, Brain, Cpu, Database, HardDrive, ShieldCheck, User, Wrench } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, formatDuration, relativeTime, titleCase } from "@/lib/utils";

type Settings = {
  user: { id: string; name: string; email: string; createdAt: string };
  preferences: { theme: string; density: string; reducedMotion: boolean; autoApproveRead: boolean; defaultProjectId: string | null };
  notificationPrefs: Record<string, boolean>;
  ai: {
    id: string;
    label: string;
    model: string;
    demoMode: boolean;
    supportsStreaming: boolean;
    supportsStructuredOutput: boolean;
    supportsToolCalling: boolean;
    hasKey: boolean;
    health: { ok: boolean; detail: string; latencyMs: number };
  };
  storage: { id: string; label: string; configured: boolean };
  runtime: Record<string, string | boolean>;
  integrations: Array<{ kind: string; status: string }>;
};

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/api/settings"),
  });
  const { data: memory } = useQuery({
    queryKey: ["memory"],
    queryFn: () =>
      api.get<{
        memories: Array<{ id: string; content: string; type: string; scope: string; importance: number; enabled: boolean; pinned: boolean; updatedAt: string }>;
        counts: Array<{ type: string; count: number }>;
      }>("/api/memory"),
  });

  const [name, setName] = React.useState("");
  React.useEffect(() => {
    if (data?.user) setName(data.user.name);
  }, [data]);

  async function patch(body: Record<string, unknown>) {
    await api.patch("/api/settings", body);
    toast({ tone: "success", title: "Settings saved" });
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-5 py-8 md:px-8">
        <LoadingRows rows={5} />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-8 md:px-8">
      <PageHeader title="Settings" description="Profile, intelligence, memory, permissions, integrations and data control." />

      <Tabs defaultValue="profile" className="mt-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security & data</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-5 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-3.5 w-3.5" /> Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" value={data.user.email} disabled />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="theme">Theme</Label>
                  <Select
                    id="theme"
                    defaultValue={data.preferences.theme}
                    onChange={(e) => void patch({ theme: e.target.value })}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="system">System</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="density">Density</Label>
                  <Select id="density" defaultValue={data.preferences.density} onChange={(e) => void patch({ density: e.target.value })}>
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-[10px] border border-line bg-surface-1 px-3 py-2.5">
                <div>
                  <p className="text-[12.5px] text-ink">Reduce motion</p>
                  <p className="text-[11px] text-mute">Disables non-essential animation.</p>
                </div>
                <Switch
                  defaultChecked={data.preferences.reducedMotion}
                  onCheckedChange={(value) => void patch({ reducedMotion: value })}
                  aria-label="Reduce motion"
                />
              </div>
              <Button variant="primary" size="md" onClick={() => void patch({ name })}>
                Save profile
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="mt-5 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5" /> AI provider
              </CardTitle>
              <p className="text-[11.5px] text-mute mt-1">
                NEXUS talks to models through a provider abstraction. Configure OPENAI_API_KEY to switch from the
                deterministic engine to a hosted model — no code changes required.
              </p>
            </CardHeader>
            <CardContent className="space-y-3 pt-3 text-[12.5px]">
              <Row label="Active provider" value={data.ai.label} />
              <Row label="Model" value={<code className="font-mono text-[11.5px] text-dim">{data.ai.model}</code>} />
              <Row
                label="Status"
                value={
                  <Badge tone={data.ai.health.ok ? "success" : "warning"}>{data.ai.health.ok ? "Healthy" : "Degraded"}</Badge>
                }
              />
              <Row label="Detail" value={<span className="text-dim">{data.ai.health.detail}</span>} />
              <Row label="Health check" value={formatDuration(data.ai.health.latencyMs)} />
              <Row
                label="Capabilities"
                value={
                  <span className="flex flex-wrap gap-1.5">
                    {[
                      ["Streaming", data.ai.supportsStreaming],
                      ["Structured output", data.ai.supportsStructuredOutput],
                      ["Tool calling", data.ai.supportsToolCalling],
                    ].map(([label, enabled]) => (
                      <Badge key={String(label)} tone={enabled ? "success" : "neutral"}>
                        {String(label)}
                      </Badge>
                    ))}
                  </span>
                }
              />
              <Row
                label="Mode"
                value={
                  data.ai.demoMode ? (
                    <Badge tone="violet">DEMO MODE — deterministic local inference</Badge>
                  ) : (
                    <Badge tone="success">Live model provider</Badge>
                  )
                }
              />
              <div className="rounded-[10px] border border-line bg-surface-1 p-3 text-[11.5px] leading-relaxed text-mute">
                Secret keys are read server-side only. They are never bundled into client JavaScript and are never
                returned by this API — the response above contains no credential material.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-3.5 w-3.5" /> Storage
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3 text-[12.5px]">
              <Row label="Driver" value={data.storage.label} />
              <Row label="Configured" value={<Badge tone={data.storage.configured ? "success" : "warning"}>{String(data.storage.configured)}</Badge>} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agents" className="mt-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5" /> Agent defaults
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="flex items-center justify-between rounded-[10px] border border-line bg-surface-1 px-3 py-2.5">
                <div>
                  <p className="text-[12.5px] text-ink">Auto-approve READ tool calls</p>
                  <p className="text-[11px] text-mute">
                    Read-only retrieval runs without interruption. WRITE, EXTERNAL and HIGH IMPACT always stop for approval.
                  </p>
                </div>
                <Switch
                  defaultChecked={data.preferences.autoApproveRead}
                  onCheckedChange={(value) => void patch({ autoApproveRead: value })}
                  aria-label="Auto-approve read tool calls"
                />
              </div>
              <p className="mt-3 text-[11.5px] text-mute">
                Per-agent model, temperature and enabled state are configured on the Agents page.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="memory" className="mt-5" id="memory">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-3.5 w-3.5" /> Memory
                </CardTitle>
                <p className="text-[11.5px] text-mute mt-1">
                  Four layers: short-term, project, long-term and explicit. Edit, disable or delete anything.
                </p>
              </div>
              <div className="flex gap-1.5">
                {(memory?.counts ?? []).map((count) => (
                  <Badge key={count.type} tone="violet">
                    {titleCase(count.type)} {count.count}
                  </Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent className="max-h-[520px] space-y-2 overflow-y-auto pt-3">
              {(memory?.memories ?? []).map((item) => (
                <div key={item.id} className="rounded-[10px] border border-line bg-surface-1 p-3">
                  <p className={cn("text-[12.5px] leading-relaxed", item.enabled ? "text-dim" : "text-mute line-through")}>
                    {item.content}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-mute">
                    <Badge tone="neutral">{titleCase(item.type)}</Badge>
                    <span>{titleCase(item.scope)}</span>
                    <span>importance {item.importance.toFixed(2)}</span>
                    <span>{relativeTime(item.updatedAt)}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <Switch
                        defaultChecked={item.enabled}
                        onCheckedChange={async (value) => {
                          await api.patch(`/api/memory/${item.id}`, { enabled: value });
                          void queryClient.invalidateQueries({ queryKey: ["memory"] });
                        }}
                        aria-label={`Enable memory ${item.id}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] text-red"
                        onClick={async () => {
                          await api.delete(`/api/memory/${item.id}`);
                          void queryClient.invalidateQueries({ queryKey: ["memory"] });
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {!memory?.memories?.length ? <p className="py-8 text-center text-[12px] text-mute">No memories stored.</p> : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permissions" className="mt-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" /> Permission model
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-3">
              {[
                { level: "READ", description: "Reading workspace data. No side effects.", auto: "Auto-approved when enabled" },
                { level: "WRITE", description: "Creates or updates workspace records.", auto: "Always requires approval" },
                { level: "EXTERNAL_ACTION", description: "Reaches an external system.", auto: "Requires approval + connected integration" },
                { level: "HIGH_IMPACT", description: "Destructive or irreversible.", auto: "Always requires approval" },
              ].map((row) => (
                <div key={row.level} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-surface-1 px-3 py-2.5">
                  <Badge tone={row.level === "HIGH_IMPACT" ? "danger" : row.level === "EXTERNAL_ACTION" ? "warning" : row.level === "WRITE" ? "accent" : "neutral"}>
                    {row.level.replace("_", " ")}
                  </Badge>
                  <span className="flex-1 text-[12px] text-dim">{row.description}</span>
                  <span className="text-[11px] text-mute">{row.auto}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-5">
          <Card>
            <CardHeader>
              <CardTitle>Notification preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-3">
              {[
                ["approvalRequired", "Approval required"],
                ["runCompleted", "Run completed"],
                ["runFailed", "Run failed"],
                ["deadlineApproaching", "Deadline approaching"],
                ["projectAtRisk", "Project at risk"],
                ["integrationError", "Integration error"],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between rounded-[10px] border border-line bg-surface-1 px-3 py-2.5">
                  <span className="text-[12.5px] text-ink">{label}</span>
                  <Switch
                    defaultChecked={data.notificationPrefs?.[key] ?? true}
                    onCheckedChange={(value) => void patch({ notifications: { [key]: value } })}
                    aria-label={label}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-5 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-3.5 w-3.5" /> Data control
              </CardTitle>
              <p className="text-[11.5px] text-mute mt-1">Export or delete your data at any time.</p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 pt-3">
              <a href="/api/artifacts?pageSize=100" target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  Export artifacts (JSON)
                </Button>
              </a>
              <a href="/api/activity?pageSize=200" target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  Export activity (JSON)
                </Button>
              </a>
              <a href="/api/memory" target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  Export memory (JSON)
                </Button>
              </a>
              <Button
                variant="ghost"
                size="sm"
                className="text-red"
                onClick={async () => {
                  await api.delete("/api/memory");
                  toast({ tone: "info", title: "Expired memories pruned" });
                  void queryClient.invalidateQueries({ queryKey: ["memory"] });
                }}
              >
                Prune expired memories
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Runtime</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-3 text-[12px]">
              {Object.entries(data.runtime).map(([key, value]) => (
                <Row key={key} label={key} value={<span className="font-mono text-[11.5px] text-dim">{String(value)}</span>} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line/60 py-2 last:border-0">
      <span className="text-mute">{label}</span>
      {value}
    </div>
  );
}
