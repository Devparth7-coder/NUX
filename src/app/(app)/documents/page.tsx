"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload, Trash2, Download, Search, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { LoadingRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn, formatBytes, relativeTime, titleCase } from "@/lib/utils";
import type { ProjectSummary } from "@/types/api";

type DocumentRow = {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  size: number;
  status: string;
  error: string | null;
  chunkCount: number;
  wordCount: number | null;
  summary: string | null;
  createdAt: string;
  ingestedAt: string | null;
  project: { id: string; name: string; color: string } | null;
};

export default function DocumentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = React.useState(false);
  const [projectId, setProjectId] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: () => api.get<{ documents: DocumentRow[] }>("/api/documents?pageSize=50"),
    refetchInterval: (query) =>
      (query.state.data as { documents: DocumentRow[] } | undefined)?.documents?.some((d) => ["UPLOADED", "EXTRACTING", "CHUNKING", "EMBEDDING"].includes(d.status))
        ? 2000
        : false,
  });

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ projects: ProjectSummary[] }>("/api/projects?pageSize=50"),
  });

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (projectId) form.append("projectId", projectId);
      const result = await api.post<{ document: { title: string; chunks: number; status: string } }>("/api/documents", form);
      toast({
        tone: "success",
        title: "Document indexed",
        body: `${result.document.title} → ${result.document.chunks} chunks embedded.`,
      });
      setUploading(false);
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (err) {
      toast({ tone: "error", title: "Ingestion failed", body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.delete(`/api/documents/${id}`);
    toast({ tone: "info", title: "Document deleted" });
    setSelected(null);
    void queryClient.invalidateQueries({ queryKey: ["documents"] });
  }

  const filtered = (data?.documents ?? []).filter((doc) =>
    search ? doc.title.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 py-8 md:px-8">
      <PageHeader
        title="Documents"
        description="Upload PDF, DOCX, TXT, MD or CSV. NEXUS extracts, chunks, embeds and indexes every file so agents can retrieve real evidence."
        actions={
          <Button variant="primary" size="md" onClick={() => setUploading(true)}>
            <Upload className="h-3.5 w-3.5" /> Upload
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter documents…" className="pl-9" />
        </div>
        <span className="text-[11.5px] text-mute">{filtered.length} document(s)</span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Indexed documents</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {isLoading ? (
              <LoadingRows rows={4} />
            ) : filtered.length ? (
              <ul className="space-y-2">
                {filtered.map((doc) => (
                  <li key={doc.id}>
                    <button
                      onClick={() => setSelected(doc.id)}
                      className={cn(
                        "w-full rounded-[10px] border bg-surface-1 px-3 py-3 text-left transition-colors",
                        selected === doc.id ? "border-accent/40 bg-surface-2" : "border-line hover:border-line-strong hover:bg-surface-2",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-4 w-4 shrink-0 text-mute" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-ink">{doc.title}</span>
                          <span className="block text-[11px] text-mute">
                            {doc.chunkCount} chunks · {doc.wordCount ?? 0} words · {formatBytes(doc.size)} · {relativeTime(doc.createdAt)}
                          </span>
                        </span>
                        {doc.project ? (
                          <span className="hidden items-center gap-1.5 text-[11px] text-mute sm:inline-flex">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: doc.project.color }} />
                            {doc.project.name}
                          </span>
                        ) : null}
                        <Badge tone={doc.status === "INDEXED" ? "success" : doc.status === "FAILED" ? "danger" : "warning"}>
                          {doc.status === "INDEXED" ? (
                            "Indexed"
                          ) : ["UPLOADED", "EXTRACTING", "CHUNKING", "EMBEDDING"].includes(doc.status) ? (
                            <>
                              <Loader2 className="h-2.5 w-2.5 animate-spin" /> {titleCase(doc.status)}
                            </>
                          ) : (
                            titleCase(doc.status)
                          )}
                        </Badge>
                      </div>
                      {doc.error ? <p className="mt-2 text-[11px] text-red">{doc.error}</p> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={FileText}
                title="No documents"
                description="Upload a document to give NEXUS something to reason over."
                action={
                  <Button variant="primary" size="sm" onClick={() => setUploading(true)}>
                    Upload
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detail</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {selected ? (
              <DocumentDetail id={selected} onDelete={() => void remove(selected)} />
            ) : (
              <p className="py-10 text-center text-[12px] text-mute">Select a document to inspect its chunks and metadata.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={uploading} onOpenChange={setUploading}>
        <DialogContent
          title="Upload document"
          description="Files are validated, extracted, chunked, embedded with pgvector and linked into the knowledge graph."
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="doc-project">Project</Label>
              <Select id="doc-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {projects?.projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>

            <label
              htmlFor="doc-file"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-strong bg-surface-1 px-6 py-10 text-center transition-colors hover:border-accent/50"
            >
              <Upload className="h-5 w-5 text-mute" />
              <span className="text-[13px] text-ink">{file ? file.name : "Choose a file"}</span>
              <span className="text-[11.5px] text-mute">PDF, DOCX, TXT, MD, CSV · up to 25 MB</span>
              <input
                id="doc-file"
                type="file"
                accept=".pdf,.docx,.txt,.md,.csv,.json,application/pdf,text/plain,text/markdown,text/csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="md" onClick={() => setUploading(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={upload} disabled={!file} loading={busy}>
                Ingest document
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentDetail({ id, onDelete }: { id: string; onDelete: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["document", id],
    queryFn: () =>
      api.get<{
        document: DocumentRow & {
          chunks: Array<{ id: string; content: string; page: number | null; section: string | null; position: number; tokenCount: number }>;
        };
      }>(`/api/documents/${id}`),
  });

  if (isLoading) return <LoadingRows rows={3} />;
  if (!data) return <p className="text-[12px] text-mute">Document not found.</p>;

  const { document } = data;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-[13.5px] font-medium text-ink">{document.title}</h4>
        <p className="text-[11.5px] text-mute">
          {document.filename} · {formatBytes(document.size)} · {relativeTime(document.createdAt)}
        </p>
        {document.summary ? <p className="mt-2 text-[12px] leading-relaxed text-dim">{document.summary}</p> : null}
      </div>

      <div className="flex gap-2">
        <a href={`/api/documents/${document.id}/download`} download>
          <Button variant="secondary" size="sm">
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
        </a>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </div>

      <div>
        <p className="mb-2 text-[11px] uppercase tracking-[0.1em] text-mute">Chunks ({document.chunks.length})</p>
        <ul className="space-y-2">
          {document.chunks.slice(0, 12).map((chunk) => (
            <li key={chunk.id} className="rounded-[10px] border border-line bg-surface-1 p-2.5">
              <div className="flex items-center gap-2 text-[10.5px] text-mute">
                <span className="font-mono">#{chunk.position}</span>
                {chunk.page ? <span>p{chunk.page}</span> : null}
                {chunk.section ? <span className="truncate">{chunk.section}</span> : null}
              </div>
              <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-dim">{chunk.content}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
