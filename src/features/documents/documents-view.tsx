'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, FileText, Loader2, Search, Trash2, Upload, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Callout, EmptyState } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { fetchJson } from '@/hooks/use-session';
import { relativeTime } from '@/lib/utils';

interface DocumentRow {
  id: string;
  title: string;
  mimeType: string;
  size: number;
  status: string;
  error: string | null;
  chunkCount: number;
  wordCount: number;
  pageCount: number;
  summary: string | null;
  updatedAt: string;
  project: { id: string; name: string } | null;
}

export function DocumentsView({ autoUpload }: { autoUpload?: boolean }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const [query, setQuery] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [dragging, setDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => fetchJson<{ items: { id: string; name: string }[] }>('/api/projects'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['documents', projectId],
    queryFn: () => fetchJson<{ items: DocumentRow[] }>(`/api/documents${projectId ? `?projectId=${projectId}` : ''}`),
  });

  React.useEffect(() => {
    if (autoUpload) inputRef.current?.click();
  }, [autoUpload]);

  const documents = (data?.items ?? []).filter((d) =>
    !query ? true : `${d.title} ${d.summary ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const form = new FormData();
        form.append('file', file);
        if (projectId) form.append('projectId', projectId);
        const res = await fetch('/api/documents', { method: 'POST', body: form });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error?.message ?? 'Upload failed');
        push({
          title: 'Document indexed',
          description: `${file.name} → ${data.document.chunkCount} chunks, ${data.document.wordCount} words`,
          tone: 'success',
        });
        await qc.invalidateQueries({ queryKey: ['documents'] });
      } catch (error) {
        push({ title: 'Ingestion failed', description: error instanceof Error ? error.message : undefined, tone: 'error' });
      } finally {
        setUploading(null);
      }
    }
  }

  async function remove(id: string, title: string) {
    await fetchJson(`/api/documents/${id}`, { method: 'DELETE' });
    push({ title: 'Document deleted', description: title, tone: 'info' });
    await qc.invalidateQueries({ queryKey: ['documents'] });
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Documents</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.025em] text-ink">Corpus NEXUS can retrieve from</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            Uploads go through the real pipeline: validate → extract → chunk → embed → index → knowledge graph. Only
            indexed content is available to agents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter documents" className="h-9 w-52 pl-9" />
          </div>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 w-44">
            <option value="">All projects</option>
            {(projectsData?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button variant="primary" onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4" /> Upload
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => void upload(e.target.files)}
          />
        </div>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`relative cursor-pointer overflow-hidden rounded-2xl border border-dashed p-8 text-center transition-all ${
          dragging ? 'border-accent/60 bg-accent/[0.06]' : 'border-line hover:border-line-strong hover:bg-surface-2/40'
        }`}
      >
        <div className="pointer-events-none absolute inset-x-0 -top-16 mx-auto h-32 w-1/2 rounded-full bg-accent/10 blur-3xl" />
        <Upload className="mx-auto h-5 w-5 text-ink-faint" />
        <p className="mt-3 text-[14px] font-medium text-ink">Drop files to ingest</p>
        <p className="mt-1 text-[12.5px] text-ink-faint">PDF, DOCX, TXT, MD, CSV, JSON or images · up to 20MB each</p>
        {uploading ? (
          <p className="mt-3 flex items-center justify-center gap-2 text-[12.5px] text-accent-soft">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Ingesting {uploading}…
          </p>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      ) : documents.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Indexed corpus</CardTitle>
            <span className="font-mono text-2xs text-ink-faint">{documents.length} documents</span>
          </CardHeader>
          <CardContent className="space-y-2">
            {documents.map((doc, index) => (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.2) }}
                className="group flex flex-wrap items-start gap-3 rounded-lg border border-line bg-surface-2/40 p-3.5 transition-colors hover:border-line-strong"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-1">
                  <FileText className="h-3.5 w-3.5 text-ink-faint" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/documents/${doc.id}`} className="text-[13.5px] font-medium text-ink hover:text-accent-soft">
                      {doc.title}
                    </Link>
                    <Badge
                      variant={
                        doc.status === 'INDEXED' ? 'good' : doc.status === 'FAILED' ? 'bad' : doc.status === 'PENDING' ? 'default' : 'accent'
                      }
                    >
                      {doc.status === 'INDEXED' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
                      {doc.status === 'FAILED' ? <XCircle className="mr-1 h-3 w-3" /> : null}
                      {doc.status}
                    </Badge>
                    {doc.project ? <span className="text-2xs text-ink-faint">{doc.project.name}</span> : null}
                  </div>
                  {doc.summary ? <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-muted">{doc.summary}</p> : null}
                  {doc.error ? <p className="mt-1 text-[12px] text-bad">{doc.error}</p> : null}
                  <p className="mt-1.5 font-mono text-2xs text-ink-faint">
                    {doc.chunkCount} chunks · {doc.wordCount} words · {doc.pageCount} pages · {(doc.size / 1024).toFixed(0)} KB ·{' '}
                    {relativeTime(doc.updatedAt)}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Link href={`/documents/${doc.id}`}>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-2xs">
                      Inspect
                    </Button>
                  </Link>
                  <a href={`/api/documents/${doc.id}/download`}>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-2xs">
                      Download
                    </Button>
                  </a>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-2xs" onClick={() => void remove(doc.id, doc.title)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={FileText}
          title="No documents indexed"
          description="Upload a document to make it retrievable. NEXUS will chunk, embed and index it into the knowledge graph."
          action={
            <Button variant="primary" size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="h-4 w-4" /> Upload document
            </Button>
          }
        />
      )}

      <Callout tone="info" title="How retrieval works">
        Chunks are embedded with the configured embedding provider and scored with hybrid retrieval (cosine similarity +
        BM25 + project + recency + entity signals). Agents only see content that has been indexed — nothing is inferred.
      </Callout>
    </div>
  );
}
