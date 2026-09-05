import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DocumentInspector } from '@/features/documents/document-inspector';

export const dynamic = 'force-dynamic';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser();

  const document = await prisma.document.findFirst({
    where: { id, workspaceId: user.workspaceId },
    include: {
      chunks: { orderBy: { position: 'asc' }, select: { id: true, content: true, page: true, section: true, position: true, tokenCount: true } },
      project: { select: { id: true, name: true } },
    },
  });
  if (!document) notFound();

  const entities = JSON.parse(document.entities || '[]') as { name: string; type: string; occurrences: number }[];

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/documents" className="flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Documents
        </Link>
        <span className="text-ink-faint">/</span>
        <span className="text-[13px] text-ink">{document.title}</span>
        <Badge variant={document.status === 'INDEXED' ? 'good' : document.status === 'FAILED' ? 'bad' : 'accent'} className="ml-auto">
          {document.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2">
              <FileText className="h-4 w-4 text-ink-faint" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-[17px]">{document.title}</CardTitle>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                {document.summary ?? 'No summary available.'}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Meta label="Chunks" value={String(document.chunkCount)} />
            <Meta label="Words" value={String(document.wordCount)} />
            <Meta label="Pages" value={String(document.pageCount)} />
            <Meta label="Type" value={document.mimeType.split('/').pop() ?? '—'} />
          </div>
          {entities.length ? (
            <div className="mt-4">
              <p className="label mb-2">Entities extracted into the knowledge graph</p>
              <div className="flex flex-wrap gap-1.5">
                {entities.map((entity) => (
                  <Badge key={`${entity.type}-${entity.name}`} variant="violet">
                    {entity.name} · {entity.type.toLowerCase()} · {entity.occurrences}×
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          {document.error ? (
            <p className="mt-4 rounded-lg border border-bad/25 bg-bad/5 p-3 text-[13px] text-bad">{document.error}</p>
          ) : null}
        </CardContent>
      </Card>

      <DocumentInspector
        documentId={document.id}
        chunks={document.chunks.map((c) => ({
          id: c.id,
          content: c.content,
          page: c.page,
          section: c.section,
          position: c.position,
          tokenCount: c.tokenCount,
        }))}
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/40 p-3">
      <p className="label">{label}</p>
      <p className="mt-1 text-[15px] font-medium text-ink">{value}</p>
    </div>
  );
}
