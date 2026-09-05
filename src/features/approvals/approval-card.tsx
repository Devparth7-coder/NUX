'use client';

import * as React from 'react';
import { Check, Pencil, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { cn } from '@/lib/utils';

export interface ApprovalRecord {
  id: string;
  title: string;
  description: string;
  whatWillHappen: string;
  whyNeeded: string;
  toolKey: string | null;
  toolArguments: string;
  affectedData: string;
  permission: string;
  riskLevel: string;
  status: string;
  decisionNote?: string | null;
  result?: string | null;
  createdAt: string;
}

function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ApprovalCard({
  approval,
  onDecided,
  compact,
}: {
  approval: ApprovalRecord;
  onDecided?: () => void;
  compact?: boolean;
}) {
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [modifyOpen, setModifyOpen] = React.useState(false);
  const [modifiedArgs, setModifiedArgs] = React.useState(approval.toolArguments);
  const [note, setNote] = React.useState('');

  const pending = approval.status === 'PENDING';

  async function decide(decision: 'APPROVED' | 'DENIED' | 'MODIFIED') {
    setBusy(true);
    try {
      await fetchJson(`/api/approvals/${approval.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          note: note || undefined,
          modifiedArgs: decision === 'MODIFIED' ? JSON.parse(modifiedArgs || '{}') : undefined,
        }),
      });
      push({
        title: decision === 'APPROVED' ? 'Approved' : decision === 'DENIED' ? 'Denied' : 'Modified and approved',
        description: approval.title,
        tone: decision === 'DENIED' ? 'error' : 'success',
      });
      setModifyOpen(false);
      onDecided?.();
    } catch (error) {
      push({ title: 'Decision failed', description: error instanceof Error ? error.message : 'Unknown error', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const args = React.useMemo(() => {
    try {
      return JSON.parse(approval.toolArguments) as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [approval.toolArguments]);

  const affected = React.useMemo(() => {
    try {
      return JSON.parse(approval.affectedData) as string[];
    } catch {
      return [];
    }
  }, [approval.affectedData]);

  return (
    <>
      <Card className={cn('overflow-hidden', pending && 'border-warn/25')}>
        <div className="flex items-start justify-between gap-3 border-b border-line-faint p-4 pb-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={approval.riskLevel === 'HIGH' ? 'bad' : 'warn'}>{approval.riskLevel} RISK</Badge>
              <Badge variant="outline">{approval.permission.replace('_', ' ')}</Badge>
              {approval.toolKey ? (
                <span className="font-mono text-2xs text-ink-faint">{approval.toolKey}</span>
              ) : null}
            </div>
            <h3 className="mt-2 text-[15px] font-semibold text-ink">{approval.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{approval.description}</p>
          </div>
          <Badge
            variant={
              approval.status === 'APPROVED' || approval.status === 'MODIFIED'
                ? 'good'
                : approval.status === 'DENIED'
                  ? 'bad'
                  : pending
                    ? 'warn'
                    : 'default'
            }
          >
            {approval.status}
          </Badge>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <p className="label mb-1">What will happen</p>
            <p className="text-[13px] leading-relaxed text-ink">{approval.whatWillHappen}</p>
          </div>
          <div>
            <p className="label mb-1">Why it is needed</p>
            <p className="text-[13px] leading-relaxed text-ink-muted">{approval.whyNeeded}</p>
          </div>

          {affected.length ? (
            <div>
              <p className="label mb-1.5">Data affected</p>
              <ul className="space-y-1">
                {affected.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[13px] text-ink-muted">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warn" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!compact && Object.keys(args).length ? (
            <div>
              <p className="label mb-1.5">Arguments</p>
              <pre className="max-h-40 overflow-auto rounded-lg border border-line bg-surface-2/60 p-3 font-mono text-[11px] leading-relaxed text-ink-muted">
                {pretty(args)}
              </pre>
            </div>
          ) : null}

          {approval.result ? (
            <div>
              <p className="label mb-1.5">Result</p>
              <pre className="max-h-32 overflow-auto rounded-lg border border-line bg-surface-2/60 p-3 font-mono text-[11px] leading-relaxed text-ink-muted">
                {pretty(JSON.parse(approval.result))}
              </pre>
            </div>
          ) : null}

          {approval.decisionNote ? (
            <p className="rounded-lg border border-line bg-surface-2/50 p-2.5 text-[12px] text-ink-muted">
              Note: {approval.decisionNote}
            </p>
          ) : null}
        </div>

        {pending ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line-faint bg-surface-2/30 p-3">
            <Button variant="success" size="sm" loading={busy} onClick={() => decide('APPROVED')}>
              <Check className="h-3.5 w-3.5" /> Approve
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setModifyOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> Modify
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => decide('DENIED')}>
              <X className="h-3.5 w-3.5" /> Deny
            </Button>
            <span className="ml-auto text-2xs text-ink-faint">Execution is paused until you decide.</span>
          </div>
        ) : null}
      </Card>

      <Modal
        open={modifyOpen}
        onClose={() => setModifyOpen(false)}
        title="Modify before approving"
        description="Edit the arguments NEXUS will use, then approve. Nothing executes until you confirm."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setModifyOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={() => decide('MODIFIED')}>
              <SlidersHorizontal className="h-3.5 w-3.5" /> Approve modified
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <p className="label mb-1.5">Arguments (JSON)</p>
            <Textarea value={modifiedArgs} onChange={(e) => setModifiedArgs(e.target.value)} rows={10} className="font-mono text-[12px]" />
          </div>
          <div>
            <p className="label mb-1.5">Note (optional)</p>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why you modified this" />
          </div>
        </div>
      </Modal>
    </>
  );
}
