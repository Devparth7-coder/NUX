'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Activity, Blocks, Cpu, Play, ShieldCheck, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { cn, formatDuration, relativeTime } from '@/lib/utils';

interface AgentRow {
  key: string;
  name: string;
  description: string;
  category: string;
  capabilities: string[];
  allowedTools: string[];
  permissionLevel: string;
  status: string;
  enabled: boolean;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  successRate: number | null;
  averageLatencyMs: number | null;
  totalTokens: number;
}

const PERMISSION_TONE: Record<string, 'default' | 'accent' | 'warn' | 'bad'> = {
  READ: 'default',
  WRITE: 'accent',
  EXTERNAL_ACTION: 'warn',
  HIGH_IMPACT: 'bad',
};

export function AgentsView() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [selected, setSelected] = React.useState<AgentRow | null>(null);
  const [instruction, setInstruction] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [output, setOutput] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () =>
      fetchJson<{ agents: AgentRow[]; recentRuns: { id: string; status: string; agent: { name: string }; intent: { objective: string } | null; createdAt: string }[] }>(
        '/api/agents',
      ),
  });

  async function runAgent() {
    if (!selected || instruction.trim().length < 3) return;
    setRunning(true);
    setOutput(null);
    try {
      const result = await fetchJson<{ output: { summary: string; toolCalls: number; artifacts: { title: string }[] }; runId: string }>(
        `/api/agents/${selected.key}/run`,
        { method: 'POST', body: JSON.stringify({ instruction }) },
      );
      setOutput(
        `${result.output.summary}\n\nTool calls: ${result.output.toolCalls}\nArtifacts: ${result.output.artifacts.map((a) => a.title).join(', ') || 'none'}`,
      );
      push({ title: `${selected.name} completed`, description: result.output.summary, tone: 'success' });
      await qc.invalidateQueries({ queryKey: ['agents'] });
    } catch (error) {
      push({ title: 'Agent run failed', description: error instanceof Error ? error.message : undefined, tone: 'error' });
    } finally {
      setRunning(false);
    }
  }

  async function toggle(agent: AgentRow) {
    await fetchJson(`/api/agents/${agent.key}`, { method: 'PATCH', body: JSON.stringify({ enabled: !agent.enabled }) });
    await qc.invalidateQueries({ queryKey: ['agents'] });
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <header>
        <p className="label">Agents</p>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">Specialised agents</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          Seven agents, each with declared capabilities, a tool allowlist and a permission ceiling. Tool calls outside an
          agent&apos;s allowlist are rejected by the registry before execution.
        </p>
      </header>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-56 rounded-xl" />
          ))}
        </div>
      ) : data?.agents.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.agents.map((agent, index) => (
            <motion.div
              key={agent.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.25) }}
            >
              <Card className={cn('flex h-full flex-col p-5', !agent.enabled && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-2">
                      <Cpu className="h-4 w-4 text-accent-soft" />
                    </span>
                    <div>
                      <h3 className="text-[14.5px] font-semibold text-ink">{agent.name}</h3>
                      <p className="text-2xs text-ink-faint">{agent.category.toLowerCase()}</p>
                    </div>
                  </div>
                  <Badge variant={PERMISSION_TONE[agent.permissionLevel] ?? 'default'}>
                    {agent.permissionLevel.replace('_', ' ')}
                  </Badge>
                </div>

                <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-ink-muted">{agent.description}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {agent.capabilities.map((capability) => (
                    <Badge key={capability} variant="outline">
                      {capability.replace('_', ' ')}
                    </Badge>
                  ))}
                </div>

                <div className="mt-3 rounded-lg border border-line bg-surface-2/40 p-2.5">
                  <p className="label mb-1.5 flex items-center gap-1.5">
                    <Wrench className="h-3 w-3" /> Allowed tools ({agent.allowedTools.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {agent.allowedTools.slice(0, 6).map((tool) => (
                      <span key={tool} className="rounded border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                        {tool}
                      </span>
                    ))}
                    {agent.allowedTools.length > 6 ? (
                      <span className="px-1 py-0.5 text-[10px] text-ink-faint">+{agent.allowedTools.length - 6}</span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line-faint pt-3">
                  <Metric label="Runs" value={agent.totalRuns} />
                  <Metric
                    label="Success"
                    value={agent.successRate !== null ? `${agent.successRate}%` : '—'}
                    tone={agent.successRate !== null && agent.successRate < 80 ? 'warn' : 'default'}
                  />
                  <Metric label="Avg" value={agent.averageLatencyMs !== null ? formatDuration(agent.averageLatencyMs) : '—'} />
                </div>

                <div className="mt-3 flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setSelected(agent);
                      setInstruction(`${agent.name}: `);
                      setOutput(null);
                    }}
                  >
                    <Play className="h-3.5 w-3.5" /> Run agent
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void toggle(agent)}>
                    {agent.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Blocks} title="No agents registered" />
      )}

      {data?.recentRuns.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <Activity className="h-3.5 w-3.5 text-ink-faint" /> Recent agent runs
            </CardTitle>
            <Link href="/activity" className="text-2xs text-accent-soft hover:underline">
              Activity center
            </Link>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data.recentRuns.slice(0, 8).map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{run.intent?.objective ?? 'Single agent run'}</span>
                <span className="shrink-0 text-2xs text-ink-faint">{run.agent.name}</span>
                <Badge variant={run.status === 'COMPLETED' ? 'good' : run.status === 'FAILED' ? 'bad' : 'default'}>
                  {run.status.replace('_', ' ')}
                </Badge>
                <span className="shrink-0 text-2xs text-ink-faint">{relativeTime(run.createdAt)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={`Run ${selected?.name ?? ''}`}
        description="The agent executes with its declared tools and permission ceiling. Sensitive actions stop for approval."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              Close
            </Button>
            <Button variant="primary" size="sm" loading={running} onClick={() => void runAgent()}>
              <ShieldCheck className="h-3.5 w-3.5" /> Execute
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <p className="label mb-1.5">Instruction</p>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              placeholder="Summarise the launch risks from the indexed documents."
            />
          </div>
          <div className="rounded-lg border border-line bg-surface-2/50 p-3">
            <p className="label mb-1.5">Tools this agent may call</p>
            <div className="flex flex-wrap gap-1">
              {selected?.allowedTools.map((tool) => (
                <span key={tool} className="rounded border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                  {tool}
                </span>
              ))}
            </div>
          </div>
          {output ? (
            <div className="rounded-lg border border-good/25 bg-good/5 p-3">
              <p className="label mb-1.5 text-good">Output</p>
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">{output}</p>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'warn' }) {
  return (
    <div>
      <p className={cn('text-[15px] font-semibold leading-none', tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-ink-faint">{label}</p>
    </div>
  );
}
