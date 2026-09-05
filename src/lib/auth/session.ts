/**
 * Session management. Signed, httpOnly, server-side verified.
 * Session tokens are opaque to the client and never contain secrets.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { prisma } from '../db';
import { env } from '../env';

export const SESSION_COOKIE = 'nexus_session';
const SESSION_DAYS = 30;

function sign(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('hex');
}

function verify(payload: string, signature: string): boolean {
  const expected = sign(payload);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

export async function createSession(userId: string, meta?: { userAgent?: string | null; ip?: string | null }) {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const random = randomBytes(24).toString('hex');
  const payload = `${userId}.${expiresAt.getTime()}.${random}`;
  const token = `${payload}.${sign(payload)}`;

  await prisma.session.create({
    data: { userId, token, expiresAt, userAgent: meta?.userAgent ?? null, ipAddress: meta?.ip ?? null },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // NEXUS is often opened inside an embedded preview (a cross-site iframe),
    // where a default Lax cookie is treated as third-party and silently dropped.
    // SameSite=None + Secure + Partitioned (CHIPS) keeps the session working in
    // that context while leaving the token httpOnly and host-scoped.
    sameSite: env.isProduction ? 'none' : 'lax',
    secure: env.isProduction,
    partitioned: env.isProduction,
    path: '/',
    expires: expiresAt,
  });

  return { token, expiresAt };
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { token } });
  store.delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
}

/**
 * Resolve a session token to a user. Used by both the httpOnly cookie path and
 * the `Authorization: Bearer` fallback (embedded contexts where cookies are
 * blocked by the browser).
 */
export async function resolveSessionUser(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const payload = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const signature = parts[3]!;
  if (!verify(payload, signature)) return null;

  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;

  const membership = await prisma.membership.findFirst({
    where: { userId: session.userId },
    include: { workspace: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: membership.role,
    avatarUrl: session.user.avatarUrl,
    workspaceId: membership.workspace.id,
    workspaceName: membership.workspace.name,
    workspaceSlug: membership.workspace.slug,
  };
}

/** Cookie first; fall back to a bearer token when the browser dropped the cookie. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const cookieToken = store.get(SESSION_COOKIE)?.value;
  if (cookieToken) {
    const user = await resolveSessionUser(cookieToken);
    if (user) return user;
  }

  const header = (await headers()).get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    return resolveSessionUser(header.slice(7).trim());
  }

  return null;
}
