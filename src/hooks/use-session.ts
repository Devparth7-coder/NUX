'use client';

import { useQuery } from '@tanstack/react-query';

export interface SessionPayload {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    avatarUrl: string | null;
    workspaceId: string;
    workspaceName: string;
    workspaceSlug: string;
  } | null;
  mode: 'REAL' | 'DEMO';
}

export const TOKEN_KEY = 'nexus.session.token';

export function storedToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — cookie path still applies */
  }
}

/**
 * JSON fetch helper. Sends the session token as a bearer header when present so
 * the app keeps working in embedded previews where cookies are partitioned away.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = storedToken();
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => fetchJson<SessionPayload>('/api/auth/session'),
    staleTime: 60_000,
  });
}
