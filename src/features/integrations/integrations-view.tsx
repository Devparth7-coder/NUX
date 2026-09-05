'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Link2, Plug, PlugZap, RefreshCw, ShieldAlert, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Callout } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { cn, relativeTime } from '@/lib/utils';

interface IntegrationRow {
  key: string;
  name: string;
  description: string;
  scopes: string[];
  tools: string[];
  status: string;
  accountLabel: string | null;
  lastSyncedAt: string | null;
  errorMessage: string | null;
  toolsAvailable: string[];
  hasCredentials: boolean;
}

export function IntegrationsView() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [target, setTarget] = React.useState<IntegrationRow | null>(null);
  const [credential, setCredential] = React.useState('');
  const [accountLabel, setAccountLabel] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => fetchJson<{ items: IntegrationRow[] }>('/api/integrations'),
  });

  async function connect() {
    if (!target) return;
    setBusy(true);
    try {
      await fetchJson(`/api/integrations/${target.key}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'connect',
          credentials: credential || undefined,
          accountLabel: accountLabel || `${target.name} account`,
        }),
      });
      push({ title: `${target.name} connected`, description: 'Credentials stored server-side and encrypted at rest in this deployment.', tone: 'success' });
      setTarget(null);
      setCredential('');
      setAccountLabel('');
      await qc.invalidateQueries({ queryKey: ['integrations'] });
    } catch (error) {
      push({ title: 'Connection failed', description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(item: IntegrationRow) {
    await fetchJson(`/api/integrations/${item.key}`, { method: 'PATCH', body: JSON.stringify({ action: 'disconnect' }) });
    push({ title: `${item.name} disconnected` });
    await qc.invalidateQueries({ queryKey: ['integrations'] });
  }

  const connected = (data?.items ?? []).filter((i) => i.status === 'CONNECTED').length;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Integrations</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">Connections</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Tools that need an external service stay blocked until the service is connected. The permission engine checks
            connection state before any external action is authorised.
          </p>
        </div>
        <Badge variant={connected ? 'good' : 'default'}>
          {connected} of {data?.items.length ?? 0} connected
        </Badge>
      </header>

      <Callout tone="info" title="No OAuth app is bundled with this deployment">
        Connections here are made with a token or API key you paste. The value is stored server-side in the Integration
        record and is never returned by any endpoint. If you leave the field empty the integration is marked connected but
        live calls will fail with an authentication error — NEXUS reports that failure instead of pretending success.
      </Callout>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-40 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(data?.items ?? []).map((item) => {
            const isConnected = item.status === 'CONNECTED';
            return (
              <Card key={item.key} className={cn('p-5', isConnected && 'border-good/30')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg border',
                        isConnected ? 'border-good/35 bg-good/10 text-good' : 'border-line bg-surface-2 text-ink-faint',
                      )}
                    >
                      {isConnected ? <PlugZap className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                    </span>
                    <div>
                      <h3 className="text-[14.5px] font-semibold text-ink">{item.name}</h3>
                      <p className="text-2xs text-ink-faint">
                        {item.accountLabel ?? (isConnected ? 'Connected' : 'Not connected')}
                      </p>
                    </div>
                  </div>
                  <Badge variant={isConnected ? 'good' : item.status === 'ERROR' ? 'bad' : 'default'}>{item.status}</Badge>
                </div>

                <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">{item.description}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.scopes.map((scope) => (
                    <Badge key={scope} variant="outline">
                      {scope}
                    </Badge>
                  ))}
                </div>

                <div className="mt-3 rounded-lg border border-line bg-surface-2/40 p-2.5">
                  <p className="label mb-1.5 flex items-center gap-1.5">
                    <Wrench className="h-3 w-3" /> Gated tools
                  </p>
                  {item.toolsAvailable.length ? (
                    <div className="flex flex-wrap gap-1">
                      {item.toolsAvailable.map((tool) => (
                        <span key={tool} className="rounded border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                          {tool}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11.5px] text-ink-faint">No tools bound to this integration yet.</p>
                  )}
                </div>

                {item.errorMessage ? (
                  <p className="mt-3 flex items-start gap-1.5 text-[12px] text-bad">
                    <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" /> {item.errorMessage}
                  </p>
                ) : null}

                <div className="mt-4 flex items-center gap-2 border-t border-line-faint pt-3">
                  {isConnected ? (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => void disconnect(item)}>
                        Disconnect
                      </Button>
                      <span className="ml-auto text-2xs text-ink-faint">
                        {item.lastSyncedAt ? `synced ${relativeTime(item.lastSyncedAt)}` : 'never synced'}
                      </span>
                      <RefreshCw className="h-3 w-3 text-ink-faint" />
                    </>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setTarget(item);
                        setCredential('');
                        setAccountLabel('');
                      }}
                    >
                      <Link2 className="h-3.5 w-3.5" /> Connect
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title={`Connect ${target?.name ?? ''}`}
        description="Stored server-side only. Update it any time; disconnecting removes the stored value."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={() => void connect()}>
              <KeyRound className="h-3.5 w-3.5" /> Connect
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <p className="label mb-1.5">Account label</p>
            <Input
              value={accountLabel}
              onChange={(e) => setAccountLabel(e.target.value)}
              placeholder="e.g. avery@nexus.ai"
              className="h-9 text-[13px]"
            />
          </div>
          <div>
            <p className="label mb-1.5">API token / key (optional)</p>
            <Input
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="paste token"
              className="h-9 font-mono text-[13px]"
            />
          </div>
          <div className="rounded-lg border border-line bg-surface-2/50 p-3">
            <p className="label mb-1.5">Requested scopes</p>
            <div className="flex flex-wrap gap-1">
              {target?.scopes.map((scope) => (
                <Badge key={scope} variant="outline">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
