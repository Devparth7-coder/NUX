'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Cpu, Database, HardDrive, Layers, Save, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Callout } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { cn } from '@/lib/utils';

const LEVELS = ['READ', 'WRITE', 'EXTERNAL_ACTION', 'HIGH_IMPACT'] as const;

interface SettingsResponse {
  settings: Record<string, Record<string, unknown>>;
  providers: { id: string; label: string; mode: string; supportsStreaming: boolean; supportsTools: boolean; active: boolean }[];
  activeProvider: string;
  mode: string;
  model: string;
  embeddingModel: string;
  dbProvider: string;
  storageDriver: string;
  jobDriver: string;
}

interface HealthResponse {
  status: string;
  mode: string;
  provider: { id: string; label: string; healthy: boolean; detail: string };
  db: string;
  storage: string;
  tools: number;
  agents: number;
  counts: Record<string, number>;
}

interface Policy {
  READ: boolean;
  WRITE: boolean;
  EXTERNAL_ACTION: boolean;
  HIGH_IMPACT: boolean;
  requireApprovalForAll: boolean;
}

const DEFAULT_POLICY: Policy = {
  READ: true,
  WRITE: true,
  EXTERNAL_ACTION: false,
  HIGH_IMPACT: false,
  requireApprovalForAll: false,
};

const LEVEL_HINT: Record<string, string> = {
  READ: 'Search documents, read projects, list tasks and retrieve knowledge.',
  WRITE: 'Create or update tasks, projects and artifacts inside NEXUS.',
  EXTERNAL_ACTION: 'Draft emails, create calendar events, open GitHub issues — anything that leaves NEXUS.',
  HIGH_IMPACT: 'Delete data or overwrite existing records. Always irreversible.',
};

export function SettingsView({ userName, userEmail }: { userName: string; userEmail: string }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [policy, setPolicy] = React.useState<Policy>(DEFAULT_POLICY);
  const [saving, setSaving] = React.useState(false);
  const [displayName, setDisplayName] = React.useState(userName);
  const [dirty, setDirty] = React.useState(false);

  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetchJson<SettingsResponse>('/api/settings'),
  });
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => fetchJson<HealthResponse>('/api/health'),
  });

  React.useEffect(() => {
    const stored = data?.settings?.permissions?.policy as Partial<Policy> | undefined;
    if (stored) setPolicy({ ...DEFAULT_POLICY, ...stored });
    const profile = data?.settings?.profile?.identity as { displayName?: string; timezone?: string } | undefined;
    if (profile?.displayName) setDisplayName(profile.displayName);
  }, [data]);

  function toggleLevel(level: string) {
    setPolicy((prev) => ({ ...prev, [level]: !prev[level as keyof Policy] }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await fetchJson('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ namespace: 'permissions', key: 'policy', value: policy }),
      });
      await fetchJson('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ namespace: 'profile', key: 'identity', value: { displayName } }),
      });
      setDirty(false);
      push({ title: 'Settings saved', description: 'The permission policy applies to the next tool call.', tone: 'success' });
      await qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (error) {
      push({ title: 'Could not save settings', description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const isDemo = (data?.mode ?? health?.mode) === 'DEMO';

  return (
    <div className="mx-auto max-w-[1000px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Settings</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">System settings</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            These controls change real behaviour. The permission policy below is read by the permission engine before every
            tool call.
          </p>
        </div>
        <Button variant="primary" loading={saving} onClick={() => void save()} disabled={!dirty}>
          <Save className="h-4 w-4" /> {dirty ? 'Save changes' : 'Saved'}
        </Button>
      </header>

      {/* ── System ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[14px]">
            <Cpu className="h-3.5 w-3.5 text-ink-faint" /> Runtime
          </CardTitle>
          <Badge variant={isDemo ? 'warn' : 'good'}>{isDemo ? 'DEMO MODE' : 'REAL MODE'}</Badge>
        </CardHeader>
        <CardContent>
          {isDemo ? (
            <Callout tone="warning" title="Running in DEMO MODE">
              No AI provider API key is configured, so the language model is replaced by a deterministic mock. It composes
              from your real database values and every response is tagged <code className="font-mono text-[11px]">mode: DEMO</code>.
              Intent parsing, retrieval, planning, tool execution, permissions, approvals, persistence and validation are the
              same code paths that run with a live provider. Add a key to <span className="font-mono">.env</span> and restart
              to switch.
            </Callout>
          ) : (
            <Callout tone="success" title="Live AI provider active">
              Requests are sent to {(data?.activeProvider ?? 'the configured provider').toUpperCase()}.
            </Callout>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Fact icon={Sparkles} label="Provider" value={data?.activeProvider ?? '—'} sub={data?.model ?? ''} />
            <Fact icon={Database} label="Database" value={data?.dbProvider ?? '—'} sub={`${health?.counts.intents ?? 0} intents persisted`} />
            <Fact icon={HardDrive} label="Storage" value={data?.storageDriver ?? '—'} sub={`${health?.counts.chunks ?? 0} chunks indexed`} />
            <Fact icon={Layers} label="Queue" value={data?.jobDriver ?? '—'} sub={`${health?.tools ?? 0} tools · ${health?.agents ?? 0} agents`} />
          </div>

          <div className="mt-4 rounded-lg border border-line bg-surface-2/40 p-3">
            <p className="label mb-2">Provider registry</p>
            <div className="space-y-1.5">
              {(data?.providers ?? []).map((provider) => (
                <div key={provider.id} className="flex items-center gap-3 text-[12.5px]">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      provider.active ? 'bg-good' : 'bg-line-strong',
                    )}
                  />
                  <span className="font-medium text-ink">{provider.label}</span>
                  <Badge variant={provider.mode === 'DEMO' ? 'warn' : 'good'}>{provider.mode}</Badge>
                  <span className="text-2xs text-ink-faint">
                    {provider.supportsStreaming ? 'streaming' : 'no streaming'} ·{' '}
                    {provider.supportsTools ? 'tools' : 'no tools'}
                  </span>
                  {provider.active ? <Check className="ml-auto h-3.5 w-3.5 text-good" /> : null}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Permissions ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[14px]">
            <ShieldCheck className="h-3.5 w-3.5 text-ink-faint" /> Permission policy
          </CardTitle>
          <Badge variant="accent">applies to every tool call</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {LEVELS.map((level) => (
            <div key={level} className="flex items-start gap-3 rounded-lg border border-line bg-surface-2/40 p-3">
              <button
                onClick={() => toggleLevel(level)}
                className={cn(
                  'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
                  policy[level] ? 'border-good/40 bg-good/25' : 'border-line-strong bg-surface-1',
                )}
                aria-label={`Toggle ${level}`}
              >
                <span
                  className={cn(
                    'h-3.5 w-3.5 rounded-full bg-ink transition-transform',
                    policy[level] ? 'translate-x-[18px]' : 'translate-x-[3px]',
                  )}
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">{level.replace('_', ' ')}</span>
                  <Badge variant={policy[level] ? 'good' : 'warn'}>{policy[level] ? 'auto-approved' : 'approval required'}</Badge>
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{LEVEL_HINT[level]}</p>
              </div>
            </div>
          ))}

          <div className="flex items-start gap-3 rounded-lg border border-warn/25 bg-warn/5 p-3">
            <button
              onClick={() => {
                setPolicy((prev) => ({ ...prev, requireApprovalForAll: !prev.requireApprovalForAll }));
                setDirty(true);
              }}
              className={cn(
                'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
                policy.requireApprovalForAll ? 'border-warn/50 bg-warn/30' : 'border-line-strong bg-surface-1',
              )}
              aria-label="Toggle strict mode"
            >
              <span
                className={cn(
                  'h-3.5 w-3.5 rounded-full bg-ink transition-transform',
                  policy.requireApprovalForAll ? 'translate-x-[18px]' : 'translate-x-[3px]',
                )}
              />
            </button>
            <div>
              <span className="text-[13px] font-medium text-ink">Strict mode</span>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                Require explicit approval for every mutating action, including WRITE. Nothing changes without your sign-off.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Profile ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[14px]">Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="label mb-1.5">Display name</p>
            <Input
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setDirty(true);
              }}
              className="h-9 text-[13px]"
            />
          </div>
          <div>
            <p className="label mb-1.5">Email</p>
            <Input value={userEmail} readOnly className="h-9 text-[13px] text-ink-faint" />
          </div>
          <div>
            <p className="label mb-1.5">Role</p>
            <div className="flex h-9 items-center rounded-lg border border-line bg-surface-2 px-3">
              <span className="text-[13px] text-ink">OWNER</span>
              <span className="ml-auto text-2xs text-ink-faint">full permission ceiling</span>
            </div>
          </div>
          <div>
            <p className="label mb-1.5">Embeddings</p>
            <Input value={data?.embeddingModel ?? ''} readOnly className="h-9 font-mono text-[12px] text-ink-faint" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[14px]">
            <Wrench className="h-3.5 w-3.5 text-ink-faint" /> Registered tools
          </CardTitle>
          <Badge variant="outline">{health?.tools ?? 0}</Badge>
        </CardHeader>
        <CardContent>
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Tools are registered at boot in <span className="font-mono text-[11.5px]">src/lib/tools/registry.ts</span>. Each
            declares a permission level and optional required integration. The permission engine evaluates every call —
            a tool cannot bypass it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/40 p-3">
      <p className="label flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-1.5 truncate text-[14px] font-medium text-ink">{value}</p>
      <p className="mt-0.5 truncate text-2xs text-ink-faint">{sub}</p>
    </div>
  );
}
