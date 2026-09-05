import { z } from 'zod';
import { prisma } from '../../db';
import type { AnyTool } from '../types';

export const artifactGenerate: AnyTool = {
  key: 'artifact.generate',
  name: 'Generate artifact',
  description: 'Persist a downloadable artifact (report, plan, research summary, presentation outline, table).',
  category: 'ARTIFACT_GENERATION',
  permission: 'WRITE',
  timeoutMs: 30000,
  schema: z.object({
    title: z.string().min(2),
    type: z.enum(['DOCUMENT', 'REPORT', 'RESEARCH_SUMMARY', 'PLAN', 'PRESENTATION', 'TABLE', 'ANALYSIS']).default('REPORT'),
    content: z.string().min(1),
    format: z.enum(['markdown', 'json', 'text', 'html']).default('markdown'),
    projectId: z.string().optional(),
  }),
  async handler(args, ctx) {
    const artifact = await prisma.artifact.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        projectId: args.projectId ?? ctx.projectId ?? null,
        intentId: ctx.intentId ?? null,
        runId: ctx.runId ?? null,
        type: args.type,
        title: args.title,
        content: args.content,
        format: args.format,
        source: 'AGENT',
        createdBy: ctx.agentKey ? `agent:${ctx.agentKey}` : 'NEXUS',
      },
    });
    return { created: true, id: artifact.id, title: artifact.title, type: artifact.type, chars: artifact.content.length };
  },
};

export const artifacts: AnyTool[] = [artifactGenerate];
