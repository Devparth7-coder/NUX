import { prisma } from '@/lib/db';
import { getProvider, listProviders } from '@/lib/ai';
import { env } from '@/lib/env';
import { toolRegistry } from '@/lib/tools/registry';
import { AGENTS } from '@/lib/agents/registry';
import { handler, ok } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async () => {
  const provider = getProvider();
  const health = await provider.health();
  const counts = {
    projects: await prisma.project.count(),
    documents: await prisma.document.count(),
    chunks: await prisma.documentChunk.count(),
    tasks: await prisma.task.count(),
    memories: await prisma.memory.count(),
    intents: await prisma.intent.count(),
    runs: await prisma.agentRun.count(),
  };
  return ok({
    status: 'ok',
    mode: provider.mode,
    provider: { id: provider.id, label: provider.label, healthy: health.ok, detail: health.detail },
    providers: listProviders(),
    db: env.dbProvider,
    storage: env.storageDriver,
    tools: toolRegistry.keys().length,
    agents: AGENTS.length,
    counts,
  });
});
