import { z } from 'zod';
import { prisma } from '../../db';
import { hybridSearchKnowledge } from '../../retrieval/search';
import { embedSyncSerialized } from '../../ai';
import type { AnyTool } from '../types';

export const knowledgeRetrieve: AnyTool = {
  key: 'knowledge.retrieve',
  name: 'Retrieve knowledge',
  description: 'Retrieve knowledge-graph items relevant to a query, with provenance.',
  category: 'KNOWLEDGE',
  permission: 'READ',
  timeoutMs: 15000,
  schema: z.object({ query: z.string().min(2), limit: z.number().int().min(1).max(30).default(6), projectId: z.string().optional() }),
  async handler(args, ctx) {
    const hits = await hybridSearchKnowledge({
      workspaceId: ctx.workspaceId,
      query: args.query,
      projectId: args.projectId ?? ctx.projectId ?? null,
      limit: args.limit,
    });
    return { query: args.query, count: hits.length, items: hits };
  },
};

export const knowledgeCreate: AnyTool = {
  key: 'knowledge.create',
  name: 'Create knowledge item',
  description: 'Persist a new item in the knowledge graph. Real write.',
  category: 'KNOWLEDGE',
  permission: 'WRITE',
  timeoutMs: 15000,
  schema: z.object({
    title: z.string().min(2),
    content: z.string().default(''),
    type: z.enum(['PROJECT', 'PERSON', 'DOCUMENT', 'TASK', 'CONCEPT', 'DECISION', 'TECHNOLOGY', 'ORGANIZATION']).default('CONCEPT'),
    confidence: z.number().min(0).max(1).default(0.8),
    projectId: z.string().optional(),
  }),
  async handler(args, ctx) {
    const item = await prisma.knowledgeItem.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId: args.projectId ?? ctx.projectId ?? null,
        title: args.title,
        content: args.content,
        summary: args.content.slice(0, 280),
        type: args.type,
        confidence: args.confidence,
        source: 'AGENT',
        sourceId: ctx.runId ?? null,
        embedding: embedSyncSerialized(`${args.title} ${args.content}`),
      },
    });
    return { created: true, id: item.id, title: item.title, type: item.type };
  },
};

export const knowledgeRelate: AnyTool = {
  key: 'knowledge.relate',
  name: 'Relate knowledge items',
  description: 'Create a typed edge between two existing knowledge items.',
  category: 'KNOWLEDGE',
  permission: 'WRITE',
  timeoutMs: 15000,
  schema: z.object({
    fromTitle: z.string(),
    toTitle: z.string(),
    type: z.enum(['RELATED_TO', 'DEPENDS_ON', 'MENTIONS', 'CREATED_FROM', 'BLOCKS', 'DECIDED_BY', 'PART_OF', 'SIMILAR_TO']).default('RELATED_TO'),
    weight: z.number().min(0).max(1).default(1),
  }),
  async handler(args, ctx) {
    const from = await prisma.knowledgeItem.findFirst({ where: { workspaceId: ctx.workspaceId, title: { contains: args.fromTitle } } });
    const to = await prisma.knowledgeItem.findFirst({ where: { workspaceId: ctx.workspaceId, title: { contains: args.toTitle } } });
    if (!from || !to) {
      return { created: false, reason: 'One or both knowledge items were not found. No relationship was invented.' };
    }
    const rel = await prisma.knowledgeRelation.upsert({
      where: { fromId_toId_type: { fromId: from.id, toId: to.id, type: args.type } },
      create: { fromId: from.id, toId: to.id, type: args.type, weight: args.weight, source: 'AGENT' },
      update: { weight: args.weight },
    });
    return { created: true, id: rel.id, from: from.title, to: to.title, type: rel.type };
  },
};

export const knowledge: AnyTool[] = [knowledgeRetrieve, knowledgeCreate, knowledgeRelate];
