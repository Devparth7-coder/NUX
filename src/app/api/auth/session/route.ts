import { getSessionUser } from '@/lib/auth/session';
import { handler, ok } from '@/lib/api/response';
import { isDemo } from '@/lib/ai';

export const runtime = 'nodejs';

export const GET = handler(async () => {
  const user = await getSessionUser();
  return ok({ user, mode: isDemo() ? 'DEMO' : 'REAL' });
});
