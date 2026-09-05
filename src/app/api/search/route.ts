import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guard';
import { globalSearch } from '@/lib/retrieval/global';
import { handler, ok } from '@/lib/api/response';

export const runtime = 'nodejs';

export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const query = req.nextUrl.searchParams.get('q') ?? '';
  const results = await globalSearch({ workspaceId: user.workspaceId, userId: user.id, query });
  return ok({ query, results, total: results.length });
});
