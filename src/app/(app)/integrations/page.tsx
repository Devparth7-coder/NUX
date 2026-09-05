"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Puzzle, Plug, Unplug, Lock } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { LoadingRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, titleCase } from "@/lib/utils";

type IntegrationRow = {
  id: string;
  kind: string;
  status: string;
  accountLabel: string | null;
  scopes: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  connected: boolean;
  toolsAvailable: string[];
};

const COPY: Record<string, { label: string; description: string; scopes: string }> = {
  GITHUB: { label: "GitHub", description: "Read repositories and create issues as part of an execution.", scopes: "repo, issues:write" },
  GOOGLE_DRIVE: { label: "Google Drive", description: "Sync documents from Drive into the knowledge base.", scopes: "drive.readonly" },
  GOOGLE_CALENDAR: { label: "Google Calendar", description: "Create events for deadlines and milestones.", scopes: "calendar.events" },
  GMAIL: { label: "Gmail", description: "Draft announcements and follow-ups for approval.", scopes: "gmail.compose" },
  SLACK: { label: "Slack", description: "Post run summaries to a channel.", scopes: "chat:write" },
  NOTION: { label: "Notion", description: "Sync pages as documents and knowledge.", scopes: "read, write" },
};

export default function IntegrationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = React.useState<IntegrationRow | null>(null);
  const [token, setToken] = React.useState("");
  const [account, setAccount] = React.useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.get<{ integrations: IntegrationRow[] }>("/api/integrations"),
  });

  async function connect() {
    if (!connecting) return;
    try {
      await api.patch(`/api/integrations/${connecting.id}`, {
        action: "connect",
        token,
        accountLabel: account || null,
        scopes: COPY[connecting.kind]?.scopes.split(", ") ?? [],
      });
      toast({ tone: "success", title: `${COPY[connecting.kind]?.label ?? connecting.kind} connected` });
      setConnecting(null);
      setToken("");
      setAccount("");
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    } catch (err) {
      toast({ tone: "error", title: "Connection failed", body: err instanceof Error ? err.message : String(err) });
    }
  }

  async function disconnect(integration: IntegrationRow) {
    await api.patch(`/api/integrations/${integration.id}`, { action: "disconnect" });
    toast({ tone: "info", title: `${COPY[integration.kind]?.label ?? integration.kind} disconnected` });
    void queryClient.invalidateQueries({ queryKey: ["integrations"] });
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-8 md:px-8">
      <PageHeader
        title="Integrations"
        description="External tools stay unavailable until you connect them. Credentials are encrypted at rest and never sent to the browser."
      />

      <div className="mt-6 rounded-[12px] border border-line bg-surface-1 px-4 py-3 text-[12px] text-dim">
        <span className="inline-flex items-center gap-2 text-mute">
          <Lock className="h-3.5 w-3.5" /> Secrets never leave the server.
        </span>{" "}
        Tokens are encrypted with AES-256-GCM before they are stored, and only the connection status is exposed to this page.
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {isLoading ? (
          <LoadingRows rows={4} />
        ) : (
          (data?.integrations ?? []).map((integration) => {
            const copy = COPY[integration.kind] ?? { label: titleCase(integration.kind), description: "", scopes: "" };
            return (
              <Card key={integration.id} className={cn(integration.connected && "border-emerald/25")}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-[10px] border",
                        integration.connected ? "border-emerald/30 bg-emerald/10" : "border-line bg-surface-2",
                      )}
                    >
                      <Puzzle className={cn("h-4 w-4", integration.connected ? "text-emerald" : "text-mute")} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[13.5px] font-medium text-ink">{copy.label}</h3>
                        <Badge tone={integration.connected ? "success" : "neutral"} className="ml-auto">
                          {integration.connected ? "Connected" : "Not configured"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-mute">{copy.description}</p>

                      {integration.toolsAvailable.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {integration.toolsAvailable.map((tool) => (
                            <code key={tool} className="rounded-md border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[10.5px] text-dim">
                              {tool}
                            </code>
                          ))}
                        </div>
                      ) : null}

                      {integration.lastError ? <p className="mt-2 text-[11px] text-red">{integration.lastError}</p> : null}

                      <div className="mt-4 flex items-center gap-2">
                        {integration.connected ? (
                          <Button variant="secondary" size="sm" onClick={() => void disconnect(integration)}>
                            <Unplug className="h-3.5 w-3.5" /> Disconnect
                          </Button>
                        ) : (
                          <Button variant="primary" size="sm" onClick={() => setConnecting(integration)}>
                            <Plug className="h-3.5 w-3.5" /> Connect
                          </Button>
                        )}
                        <span className="text-[10.5px] text-mute">scopes: {copy.scopes}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Dialog open={Boolean(connecting)} onOpenChange={(open) => !open && setConnecting(null)}>
        <DialogContent
          title={`Connect ${connecting ? (COPY[connecting.kind]?.label ?? connecting.kind) : ""}`}
          description="Paste a personal access token. It is encrypted before storage and is never returned to the client."
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="account">Account label</Label>
              <Input id="account" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="ava@nexus.ai" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token">Access token</Label>
              <Input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="••••••••" autoComplete="off" />
            </div>
            <p className="text-[11.5px] leading-relaxed text-mute">
              Any external tool call still requires your approval at execution time — connecting an integration does not grant
              NEXUS permission to act on its own.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={() => setConnecting(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={connect} disabled={token.length < 4}>
                Connect
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
