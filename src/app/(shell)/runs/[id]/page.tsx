import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { ExecutionView } from '@/features/command/execution-view';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = { title: 'Run · NEXUS' };
export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser();

  const intent = await prisma.intent.findFirst({
    where: { id, userId: user.id },
    include: {
      runs: { include: { agent: true, toolExecutions: true }, orderBy: { createdAt: 'asc' } },
      project: { select: { id: true, name: true } },
    },
  });
  if (!intent) notFound();

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/command" className="flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Command
        </Link>
        <span className="text-ink-faint">/</span>
        <span className="text-[13px] text-ink">Run inspection</span>
        <Badge variant="outline" className="ml-auto font-mono">
          {intent.id}
        </Badge>
      </div>

      <ExecutionView intentId={intent.id} />

      <Card>
        <CardHeader>
          <CardTitle>Agent runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {intent.runs.map((run) => (
            <div key={run.id} className="rounded-lg border border-line bg-surface-2/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-ink">{run.agent.name}</span>
                <Badge variant={run.status === 'COMPLETED' ? 'good' : run.status === 'FAILED' ? 'bad' : run.status === 'WAITING_APPROVAL' ? 'warn' : 'default'}>
                  {run.status}
                </Badge>
                <span className="ml-auto font-mono text-2xs text-ink-faint">
                  {run.durationMs != null ? `${run.durationMs}ms` : '—'} · {run.tokens} tokens
                </span>
              </div>
              {run.error ? <p className="mt-2 text-[12.5px] text-bad">{run.error}</p> : null}
              {run.toolExecutions.length ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {run.toolExecutions.map((tool) => (
                    <span
                      key={tool.id}
                      className="rounded border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-2xs text-ink-muted"
                      title={`${tool.status}${tool.error ? ` — ${tool.error}` : ''}`}
                    >
                      {tool.toolKey}
                      <span className={tool.status === 'FAILED' ? 'text-bad' : tool.status === 'BLOCKED' ? 'text-warn' : 'text-good'}> · {tool.status.toLowerCase()}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
