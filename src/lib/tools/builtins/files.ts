import { z } from 'zod';
import { prisma } from '../../db';
import { storage } from '../../storage';
import type { AnyTool } from '../types';

export const fileRead: AnyTool = {
  key: 'files.read',
  name: 'Read stored file',
  description: 'Read a stored file by document id and return its extracted text.',
  category: 'FILES',
  permission: 'READ',
  timeoutMs: 20000,
  schema: z.object({ documentId: z.string(), maxChars: z.number().int().min(200).max(100000).default(8000) }),
  async handler(args, ctx) {
    const doc = await prisma.document.findFirst({ where: { id: args.documentId, workspaceId: ctx.workspaceId } });
    if (!doc) return { error: 'File not found.' };
    const exists = await storage().exists(doc.storageKey);
    if (!exists) return { error: 'File bytes are not present in storage.' };
    const text = doc.extractedText ?? '';
    return { documentId: doc.id, title: doc.title, mimeType: doc.mimeType, size: doc.size, content: text.slice(0, args.maxChars) };
  },
};

export const fileList: AnyTool = {
  key: 'files.list',
  name: 'List stored files',
  description: 'List files stored for the workspace.',
  category: 'FILES',
  permission: 'READ',
  timeoutMs: 15000,
  schema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  async handler(args, ctx) {
    const docs = await prisma.document.findMany({
      where: { workspaceId: ctx.workspaceId },
      select: { id: true, title: true, mimeType: true, size: true, storageKey: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
    });
    return { count: docs.length, files: docs };
  },
};

export const files: AnyTool[] = [fileRead, fileList];
