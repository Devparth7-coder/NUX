import { redirect } from 'next/navigation';
import { getSessionUser, type SessionUser } from '../../lib/auth/session';
import { NexusError, unauthorized } from '../../lib/errors';

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized('Sign in to continue');
  return user;
}

export async function requireRole(user: SessionUser, roles: string[]): Promise<void> {
  if (!roles.includes(user.role)) {
    throw new NexusError('FORBIDDEN', `This action requires one of: ${roles.join(', ')}`);
  }
}

export function clientIp(headers: Headers): string | null {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip') ?? null;
}

/**
 * For server components. Layouts and pages render concurrently, so a redirect in
 * the shell layout does not stop a page from evaluating. Redirecting here too
 * keeps an unauthenticated render clean instead of surfacing a 401 error page.
 */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}
