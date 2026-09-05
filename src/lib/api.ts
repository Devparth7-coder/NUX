import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { AppError, Errors } from "@/lib/errors";
import { getAuthContext, type AuthContext } from "@/lib/auth/guard";
import { rateLimit } from "@/lib/rate-limit";

export type ApiError = { error: { code: string; message: string; detail?: unknown; requestId?: string } };

export type RouteContext<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
  auth: AuthContext;
};

export type RouteInput<B = unknown, Q = unknown> = {
  body: B;
  query: Q;
};

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init);
}

export function fail(err: unknown): NextResponse<ApiError> {
  const requestId = Math.random().toString(36).slice(2, 10);
  if (err instanceof AppError) {
    return NextResponse.json<ApiError>(
      { error: { code: err.code, message: err.message, detail: err.detail, requestId } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json<ApiError>(
      { error: { code: "VALIDATION_ERROR", message: "Validation failed", detail: err.flatten(), requestId } },
      { status: 422 },
    );
  }
  console.error(`[api:${requestId}]`, err);
  return NextResponse.json<ApiError>(
    { error: { code: "INTERNAL", message: err instanceof Error ? err.message : "Internal server error", requestId } },
    { status: 500 },
  );
}

type Options<B extends ZodTypeAny | undefined, Q extends ZodTypeAny | undefined> = {
  auth?: boolean;
  body?: B;
  query?: Q;
  rateLimit?: { limit: number; windowMs: number };
};

/**
 * Route wrapper: rate limiting → CSRF origin check on mutating verbs → auth →
 * zod validation of body/query → handler → single error schema.
 */
export function route<B extends ZodTypeAny | undefined = undefined, Q extends ZodTypeAny | undefined = undefined, P extends Record<string, string> = Record<string, string>>(
  opts: Options<B, Q>,
  handler: (
    req: Request,
    ctx: RouteContext<P>,
    input: RouteInput<B extends ZodTypeAny ? z.infer<B> : undefined, Q extends ZodTypeAny ? z.infer<Q> : undefined>,
  ) => Promise<Response>,
) {
  return async (req: Request, rawCtx: { params: Promise<P> }): Promise<Response> => {
    try {
      if (opts.rateLimit) {
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
        const limited = rateLimit(`${new URL(req.url).pathname}:${ip}`, opts.rateLimit.limit, opts.rateLimit.windowMs);
        if (!limited.ok) throw Errors.tooManyRequests(limited.retryAfterSec);
      }

      // CSRF: mutating requests must originate from this deployment. Behind a
      // proxy the public host arrives in x-forwarded-host, so both are accepted.
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (origin) {
          let originHost = "";
          try {
            originHost = new URL(origin).host;
          } catch {
            throw Errors.forbidden("Invalid origin header");
          }
          const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
          const host = req.headers.get("host")?.split(",")[0]?.trim();
          if (!originHost || (originHost !== host && originHost !== forwardedHost)) {
            throw Errors.forbidden("Cross-origin request rejected");
          }
        }
      }

      const auth = opts.auth === false ? null : await getAuthContext();
      if (opts.auth !== false && !auth) throw Errors.unauthorized();

      const body = opts.body ? opts.body.parse(await req.json().catch(() => ({}))) : undefined;
      const query = opts.query
        ? opts.query.parse(Object.fromEntries(new URL(req.url).searchParams.entries()))
        : undefined;

      return await handler(req, { params: rawCtx.params, auth: auth as AuthContext }, { body, query } as never);
    } catch (err) {
      return fail(err);
    }
  };
}

export function parsePage(sp: URLSearchParams, defaultSize = 25) {
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? defaultSize) || defaultSize));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}
