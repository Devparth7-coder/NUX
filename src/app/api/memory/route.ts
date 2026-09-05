import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { listMemories, searchMemory, writeMemory, enforceLifecycle, MEMORY_TYPES } from '@/lib/memory/service';
import { handler, ok, validationError } from '@/lib/api/response';

export const runtime = 'nodejs';

const createSchema = z.object({
  content: z.string().min(4).max(4000),
  type: z.enum(MEMORY_TYPES as [string, ...string[]]).default('LONG_TERM'),
  importance: z.number().int().min(0).max(100).default(60),
  projectId: z.string().optional().nullable(),
  pinned: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const query = req.nextUrl.searchParams.get('q');
  const type = req.nextUrl.searchParams.get('type');

  if (query) {
    const hits = await searchMemory({
      workspaceId: user.workspaceId,
      query,
      limit: 20,
      ...(type ? { types: [type as never] } : {}),
    });
    return ok({ hits, mode: 'semantic' });
  }

  const result = await listMemories({
    workspaceId: user.workspaceId,
    ...(type ? { type: type as never } : {}),
    limit: 100,
  });
  return ok({ ...result, mode: 'list' });
});

export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const { memory, deduped } = await writeMemory({
    workspaceId: user.workspaceId,
    userId: user.id,
    content: parsed.data.content,
    type: parsed.data.type as never,
    importance: parsed.data.importance,
    projectId: parsed.data.projectId ?? null,
    pinned: parsed.data.pinned,
    tags: parsed.data.tags,
    source: 'USER',
    confidence: 1,
  });

  await enforceLifecycle(user.workspaceId);
  return ok({ memory, deduped }, { status: 201 });
});
