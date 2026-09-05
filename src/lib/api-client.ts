"use client";

/**
 * Typed client for the NEXUS API. Every response is checked: non-2xx throws an
 * ApiClientError carrying the server's error schema so the UI can render the
 * real reason instead of a generic message.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(message: string, status: number, code: string, detail?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const error = (data as { error?: { message?: string; code?: string; detail?: unknown } } | null)?.error;
    throw new ApiClientError(error?.message ?? `Request failed (${res.status})`, res.status, error?.code ?? "UNKNOWN", error?.detail);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, { ...init, method: "GET" }),
  post: <T>(path: string, body?: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Subscribes to a run's Server-Sent Events stream. */
export function subscribeRunEvents(
  params: { runId?: string | null; intentId?: string | null },
  handlers: { onEvent: (event: LiveEvent) => void; onError?: (err: Event) => void },
) {
  const search = new URLSearchParams();
  if (params.runId) search.set("runId", params.runId);
  if (params.intentId) search.set("intentId", params.intentId);
  const source = new EventSource(`/api/events/stream?${search.toString()}`);

  const handle = (event: MessageEvent) => {
    try {
      handlers.onEvent(JSON.parse(event.data) as LiveEvent);
    } catch {
      /* ignore malformed frame */
    }
  };

  source.addEventListener("message", handle);
  for (const kind of [
    "INTENT_RECEIVED",
    "INTENT_UNDERSTOOD",
    "CONTEXT_RETRIEVED",
    "PLAN_CREATED",
    "AGENT_SELECTED",
    "AGENT_STARTED",
    "AGENT_PROGRESS",
    "AGENT_COMPLETED",
    "AGENT_FAILED",
    "TOOL_STARTED",
    "TOOL_COMPLETED",
    "TOOL_FAILED",
    "APPROVAL_REQUESTED",
    "APPROVAL_GRANTED",
    "APPROVAL_DENIED",
    "VALIDATION_COMPLETED",
    "MEMORY_UPDATED",
    "ARTIFACT_CREATED",
    "RESULT_READY",
    "ERROR",
  ]) {
    source.addEventListener(kind, handle as EventListener);
  }
  if (handlers.onError) source.onerror = handlers.onError;
  return () => source.close();
}

export type LiveEvent = {
  id: string;
  channel: string;
  type: string;
  message: string;
  detail?: Record<string, unknown>;
  at: string;
};
