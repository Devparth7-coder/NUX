import { z } from 'zod';
import { prisma } from '../../db';
import { hybridSearchChunks } from '../../retrieval/search';
import type { AnyTool } from '../types';

export const documentSearch: AnyTool = {
  key: 'documents.search',
  name: 'Search documents',
  description: 'Hybrid semantic + keyword search across every ingested document chunk in the workspace.',
  category: 'DOCUMENTS',
  permission: 'READ',
  timeoutMs: 15000,
  schema: z.object({
    query: z.string().min(2),
    limit: z.number().int().min(1).max(25).default(8),
    projectId: z.string().optional(),
  }),
  async handler(args, ctx) {
    const hits = await hybridSearchChunks({
      workspaceId: ctx.workspaceId,
      query: args.query,
      projectId: args.projectId ?? ctx.projectId ?? null,
      limit: args.limit,
    });
    return {
      query: args.query,
      count: hits.length,
      hits: hits.map((h) => ({
        documentId: h.documentId,
        documentTitle: h.documentTitle,
        page: h.page,
        section: h.section,
        snippet: h.content.slice(0, 600),
        relevance: Number(h.scores.relevance.toFixed(4)),
        why: h.rationale,
      })),
    };
  },
};

export const documentRead: AnyTool = {
  key: 'documents.read',
  name: 'Read document',
  description: 'Read the indexed content of a document, optionally restricted to a page range.',
  category: 'DOCUMENTS',
  permission: 'READ',
  timeoutMs: 15000,
  schema: z.object({
    documentId: z.string().optional(),
    title: z.string().optional(),
    maxChars: z.number().int().min(200).max(200000).default(12000),
  }),
  async handler(args, ctx) {
    const doc = await prisma.document.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        ...(args.documentId ? { id: args.documentId } : {}),
        ...(!args.documentId && args.title ? { title: { contains: args.title } } : {}),
      },
      include: { chunks: { orderBy: { position: 'asc' } } },
    });
    if (!doc) return { error: 'No document matched. Nothing was read.' };
    const text = (doc.chunks.map((c) => c.content).join('\n\n') || doc.extractedText || '').slice(0, args.maxChars);
    return {
      documentId: doc.id,
      title: doc.title,
      status: doc.status,
      pageCount: doc.pageCount,
      wordCount: doc.wordCount,
      chunkCount: doc.chunkCount,
      content: text,
    };
  },
};

export const documentList: AnyTool = {
  key: 'documents.list',
  name: 'List documents',
  description: 'List documents in the workspace with ingestion status.',
  category: 'DOCUMENTS',
  permission: 'READ',
  timeoutMs: 10000,
  schema: z.object({ projectId: z.string().optional(), limit: z.number().int().min(1).max(100).default(20) }),
  async handler(args, ctx) {
    const docs = await prisma.document.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(args.projectId ? { projectId: args.projectId } : {}),
      },
      select: { id: true, title: true, status: true, mimeType: true, chunkCount: true, wordCount: true, updatedAt: true, projectId: true },
      orderBy: { updatedAt: 'desc' },
      take: args.limit,
    });
    return { count: docs.length, documents: docs };
  },
};

export const documents: AnyTool[] = [documentSearch, documentRead, documentList];
