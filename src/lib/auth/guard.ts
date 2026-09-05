import { cache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { Errors } from "@/lib/errors";
import { readSession } from "./session";

export type AuthContext = {
  userId: string;
  workspaceId: string;
  role: string;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
  workspace: { id: string; name: string; slug: string };
};

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await readSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, avatarUrl: true },
  });
  if (!user) return null;
  const workspace = await prisma.workspace.findUnique({
    where: { id: session.workspaceId },
    select: { id: true, name: true, slug: true },
  });
  if (!workspace) return null;
  return { userId: user.id, workspaceId: workspace.id, role: session.role, user, workspace };
});

export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw Errors.unauthorized();
  return ctx;
}

/** Request-scoped metadata for audit logging. */
export async function requestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const ua = h.get("user-agent") ?? null;
  const csrf = h.get("x-nexus-csrf");
  const jar = await cookies();
  const expected = jar.get("nexus_session")?.value ? "same-origin" : null;
  return { ip, userAgent: ua, csrfHeader: csrf, csrfExpected: expected };
}
