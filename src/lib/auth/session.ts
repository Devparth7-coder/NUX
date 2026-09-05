import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

const COOKIE = "nexus_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 14;

const secret = new TextEncoder().encode(env.AUTH_SECRET);

export type SessionPayload = { userId: string; workspaceId: string; role: string };

export async function createSession(userId: string, workspaceId: string, role: string, userAgent?: string, ip?: string) {
  const expiresAt = new Date(Date.now() + MAX_AGE_SEC * 1000);
  // jti makes every token unique: two sign-ins inside the same second would
  // otherwise produce byte-identical JWTs (same claims + same iat/exp) and
  // collide on Session.token's unique index.
  const token = await new SignJWT({ workspaceId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(expiresAt)
    .sign(secret);

  // Defensive: never let a stale row with the same token block a sign-in.
  await prisma.session.deleteMany({ where: { token } }).catch(() => undefined);
  await prisma.session.create({ data: { userId, token, expiresAt, userAgent, ip } });

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
  return { token, expiresAt };
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } }).catch(() => undefined);
    jar.delete(COOKIE);
  }
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const userId = payload.sub;
    if (!userId) return null;
    const dbSession = await prisma.session.findUnique({ where: { token } });
    if (!dbSession || dbSession.expiresAt < new Date()) return null;
    return { userId, workspaceId: (payload.workspaceId as string) ?? "", role: (payload.role as string) ?? "MEMBER" };
  } catch {
    return null;
  }
}
