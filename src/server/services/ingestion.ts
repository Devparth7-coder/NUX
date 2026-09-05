import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { storage, buildStorageKey } from "@/lib/storage";
import { embedTexts } from "@/lib/retrieval/embeddings";
import { storeVectors } from "@/lib/retrieval/vector-store";
import { recordActivity } from "./activity";
import { AppError } from "@/lib/errors";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const SUPPORTED: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type IngestInput = {
  workspaceId: string;
  userId: string;
  projectId?: string | null;
  filename: string;
  mimeType: string;
  buffer: Buffer;
};

/**
 * UPLOAD → VALIDATE → EXTRACT → CHUNK → EMBED → INDEX → KNOWLEDGE
 * Every stage writes real state onto the Document row so the UI can show
 * genuine progress and genuine failures.
 */
export async function ingestDocument(input: IngestInput) {
  const { workspaceId, userId, projectId, filename, mimeType, buffer } = input;

  const kind = SUPPORTED[mimeType] ?? (IMAGE_TYPES.includes(mimeType) ? "image" : guessFromExtension(filename));
  if (!kind) throw new AppError(`Unsupported file type: ${mimeType || path.extname(filename)}`, { status: 422, code: "UNSUPPORTED_FILE_TYPE" });
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new AppError("File exceeds the 25 MB upload limit", { status: 413, code: "FILE_TOO_LARGE" });
  if (buffer.byteLength === 0) throw new AppError("File is empty", { status: 422, code: "EMPTY_FILE" });

  const stored = await storage().put(buildStorageKey(workspaceId, "documents", filename), buffer, mimeType);

  const doc = await prisma.document.create({
    data: {
      workspaceId,
      projectId: projectId ?? null,
      uploaderId: userId,
      title: titleFromFilename(filename),
      filename,
      mimeType,
      size: buffer.byteLength,
      storageKey: stored.key,
      status: "EXTRACTING",
    },
  });

  try {
    const { text, pageCount } = await extractText(kind, buffer);
    if (!text || text.trim().length < 10) {
      throw new Error("No extractable text found in this file");
    }

    await prisma.document.update({ where: { id: doc.id }, data: { status: "CHUNKING", pageCount } });

    const chunks = chunkText(text);
    await prisma.document.update({ where: { id: doc.id }, data: { status: "EMBEDDING", chunkCount: chunks.length } });

    await prisma.documentChunk.createMany({
      data: chunks.map((c, index) => ({
        documentId: doc.id,
        content: c.content,
        page: null,
        section: c.section ?? null,
        position: index,
        tokenCount: Math.ceil(c.content.length / 4),
      })),
    });

    const rows = await prisma.documentChunk.findMany({
      where: { documentId: doc.id },
      orderBy: { position: "asc" },
      select: { id: true, content: true },
    });

    // Embed in batches; each vector is written with a real pgvector upsert.
    const BATCH = 24;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const vectors = await embedTexts(slice.map((r) => r.content));
      await storeVectors("DocumentChunk", slice.map((r, idx) => ({ id: r.id, vector: vectors[idx] })));
    }

    const summary = summarize(text);
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: "INDEXED", summary, wordCount: text.split(/\s+/).length, ingestedAt: new Date() },
    });

    await linkKnowledge({ workspaceId, projectId: projectId ?? null, documentId: doc.id, title: doc.title, summary, terms: topTerms(text) });

    await recordActivity({
      workspaceId,
      userId,
      projectId: projectId ?? null,
      kind: "DOCUMENT",
      action: "document.ingest",
      summary: `Indexed “${doc.title}” (${chunks.length} chunks)`,
      detail: { documentId: doc.id, chunks: chunks.length, bytes: buffer.byteLength },
      entityType: "DOCUMENT",
      entityId: doc.id,
      status: "success",
    });

    return { id: doc.id, title: doc.title, status: "INDEXED", chunks: chunks.length, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.document.update({ where: { id: doc.id }, data: { status: "FAILED", error: message } });
    await recordActivity({
      workspaceId,
      userId,
      projectId: projectId ?? null,
      kind: "ERROR",
      action: "document.ingest_failed",
      summary: `Failed to index “${doc.title}”: ${message}`,
      detail: { documentId: doc.id, error: message },
      entityType: "DOCUMENT",
      entityId: doc.id,
      status: "error",
    });
    log.error("ingestion failed", err);
    throw err;
  }
}

async function extractText(kind: string, buffer: Buffer): Promise<{ text: string; pageCount: number | null }> {
  switch (kind) {
    case "pdf": {
      const { extractText: extractPdf, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const result = await extractPdf(pdf, { mergePages: false });
      const pages = result.text as string[] | string;
      const list = Array.isArray(pages) ? pages : [pages];
      return { text: list.join("\n\n"), pageCount: list.length };
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value, pageCount: null };
    }
    case "csv":
    case "txt":
    case "md":
    case "json":
      return { text: buffer.toString("utf8"), pageCount: null };
    case "image":
      throw new Error("Image OCR is not configured. Upload a text-based PDF, DOCX, TXT, MD or CSV file.");
    default:
      throw new Error(`Unsupported file kind: ${kind}`);
  }
}

export function chunkText(text: string, target = 900, overlap = 120) {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  const paragraphs = cleaned.split(/\n{2,}/);
  const chunks: Array<{ content: string; page?: number; section?: string | null }> = [];
  let current = "";

  const flush = () => {
    if (current.trim().length < 40) return;
    chunks.push({ content: current.trim(), section: current.split("\n")[0]?.slice(0, 80) || null });
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > target * 2) {
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if ((current + " " + sentence).length > target) {
          flush();
          current = current.slice(-overlap) + " " + sentence;
        } else {
          current += (current ? " " : "") + sentence;
        }
      }
    } else if ((current + "\n\n" + paragraph).length > target) {
      flush();
      current = paragraph.slice(0, target);
    } else {
      current += (current ? "\n\n" : "") + paragraph;
    }
  }
  flush();
  return chunks.map((c) => ({ content: c.content.trim(), section: c.section ?? undefined }));
}

function summarize(text: string, maxSentences = 3) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 400);
  return sentences.slice(0, maxSentences).join(" ");
}

function topTerms(text: string, count = 8) {
  const stop = new Set("the a an and or of to in for on with at by from is are was were be this that it as can will would should could have has had not but if then than so we you your our their".split(" "));
  const freq = new Map<string, number>();
  for (const word of text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)) {
    if (word.length < 4 || stop.has(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([w]) => w);
}

function titleFromFilename(filename: string) {
  return path.basename(filename, path.extname(filename)).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || filename;
}

function guessFromExtension(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  return ext === ".pdf" ? "pdf" : ext === ".docx" ? "docx" : ext === ".txt" ? "txt" : ext === ".md" ? "md" : ext === ".csv" ? "csv" : ext === ".json" ? "json" : "";
}

async function linkKnowledge(args: { workspaceId: string; projectId: string | null; documentId: string; title: string; summary: string; terms: string[] }) {
  const item = await prisma.knowledgeItem.create({
    data: {
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      documentId: args.documentId,
      kind: "CONCEPT",
      label: args.title,
      content: args.summary || args.title,
      source: "document-ingestion",
      confidence: 0.7,
      salience: 0.6,
      metadata: { terms: args.terms } as Prisma.InputJsonValue,
    },
  });
  try {
    const [vector] = await embedTexts([`${args.title} ${args.summary}`]);
    await storeVectors("KnowledgeItem", [{ id: item.id, vector }]);
  } catch (err) {
    log.warn("knowledge embedding failed", err);
  }

  if (args.projectId) {
    const projectItem = await prisma.knowledgeItem.findFirst({
      where: { workspaceId: args.workspaceId, projectId: args.projectId, kind: "CONCEPT", documentId: null },
      select: { id: true },
    });
    if (projectItem) {
      await prisma.knowledgeRelation
        .create({
          data: { sourceId: item.id, targetId: projectItem.id, type: "PART_OF", weight: 0.8, evidence: "Document ingested into this project", derivedFrom: "ingestion" },
        })
        .catch(() => undefined);
    }
  }
  return item.id;
}
