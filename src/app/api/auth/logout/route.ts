import { destroySession, getSessionUser } from '@/lib/auth/session';
import { handler, ok } from '@/lib/api/response';
import { audit } from '@/server/services/activity';

export const runtime = 'nodejs';

export const POST = handler(async () => {
  const user = await getSessionUser();
  if (user) await audit({ userId: user.id, action: 'auth.logout' });
  await destroySession();
  return ok({ ok: true });
});
