import type { AgentDefinition } from '../types';
import { asArray, asRecord } from '../helpers';

export const knowledgeAgent: AgentDefinition = {
  key: 'knowledge',
  name: 'Knowledge Agent',
  description: 'Understands documents, retrieves knowledge, discovers relationships and organises what the workspace knows.',
  category: 'KNOWLEDGE',
  capabilities: ['knowledge_retrieval', 'document_analysis'],
  allowedTools: ['knowledge.retrieve', 'documents.search', 'documents.list', 'artifact.generate'],
  permissionLevel: 'READ',
  temperature: 0.2,
  maxTokens: 2048,
  icon: 'network',
  systemPrompt:
    'You organise what the workspace actually knows. You surface relationships that exist in retrieved material and never infer connections that are not supported.',

  async execute(ctx) {
    await ctx.emit('Assembling project knowledge');

    const [knowledge, docs, chunks] = await Promise.all([
      ctx.callTool('knowledge.retrieve', { query: ctx.rawInput, limit: 8, projectId: ctx.projectId ?? undefined }),
      ctx.callTool('documents.list', { projectId: ctx.projectId ?? undefined, limit: 20 }),
      ctx.callTool('documents.search', { query: ctx.rawInput, limit: 6, projectId: ctx.projectId ?? undefined }),
    ]);

    const items = asArray<Record<string, unknown>>(asRecord(knowledge.result).items);
    const documents = asArray<Record<string, unknown>>(asRecord(docs.result).documents);
    const passages = asArray<Record<string, unknown>>(asRecord(chunks.result).hits);

    await ctx.emit(
      'Knowledge assembled',
      `${items.length} knowledge item(s), ${documents.length} document(s), ${passages.length} passage(s)`,
    );

    const synthesis = await ctx.ai({
      task: 'knowledge_synthesis',
      variables: {
        project: { name: ctx.intent.entities.find((e) => e.type === 'PROJECT')?.name ?? null },
        contextItems: [
          ...items.map((i) => ({ sourceType: 'knowledge', title: i.title, snippet: i.content })),
          ...passages.map((p) => ({ sourceType: 'document', title: p.documentTitle, snippet: p.snippet })),
        ],
      },
    });

    const content = [
      `# Knowledge synthesis`,
      '',
      synthesis.text,
      '',
      '## Indexed documents in scope',
      documents.length
        ? documents.map((d) => `- ${d.title} (${d.status}, ${d.chunkCount ?? 0} chunks)`).join('\n')
        : '_No documents indexed yet._',
      '',
      '## Retrieved passages',
      passages.length
        ? passages.slice(0, 6).map((p) => `- **${p.documentTitle}** — ${String(p.snippet).slice(0, 220)}`).join('\n')
        : '_No passage matched._',
    ].join('\n');

    const artifact = await ctx.callTool('artifact.generate', {
      title: 'Knowledge synthesis',
      type: 'DOCUMENT',
      content,
      format: 'markdown',
      projectId: ctx.projectId ?? undefined,
    });

    return {
      agentKey: 'knowledge',
      summary: `Synthesised ${items.length} knowledge item(s) and ${passages.length} document passage(s).`,
      data: {
        knowledgeItems: items.length,
        documents: documents.length,
        passages: passages.length,
        artifactId: asRecord(artifact.result).id ?? null,
      },
      artifacts: [{ title: 'Knowledge synthesis', type: 'DOCUMENT', content, format: 'markdown' }],
      toolCalls: 4,
      tokens: synthesis.usage.totalTokens,
    };
  },
};
