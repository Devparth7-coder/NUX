export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(message: string, opts: { status?: number; code?: string; detail?: unknown } = {}) {
    super(message);
    this.name = "AppError";
    this.status = opts.status ?? 400;
    this.code = opts.code ?? "BAD_REQUEST";
    this.detail = opts.detail;
  }
}

export const Errors = {
  unauthorized: () => new AppError("Authentication required", { status: 401, code: "UNAUTHORIZED" }),
  forbidden: (msg = "You do not have access to this resource") =>
    new AppError(msg, { status: 403, code: "FORBIDDEN" }),
  notFound: (what = "Resource") => new AppError(`${what} not found`, { status: 404, code: "NOT_FOUND" }),
  validation: (detail?: unknown) =>
    new AppError("Validation failed", { status: 422, code: "VALIDATION_ERROR", detail }),
  conflict: (msg: string) => new AppError(msg, { status: 409, code: "CONFLICT" }),
  tooManyRequests: (retryAfterSec: number) =>
    new AppError(`Rate limit exceeded. Retry in ${retryAfterSec}s`, {
      status: 429,
      code: "RATE_LIMITED",
      detail: { retryAfterSec },
    }),
  dependency: (msg: string, detail?: unknown) =>
    new AppError(msg, { status: 503, code: "DEPENDENCY_UNAVAILABLE", detail }),
  internal: (msg = "Internal server error") => new AppError(msg, { status: 500, code: "INTERNAL" }),
};

/** Provider/model/tool failure that the orchestrator can retry or fall back from. */
export class ExecutableError extends Error {
  readonly retryable: boolean;
  readonly detail?: unknown;
  constructor(message: string, opts: { retryable?: boolean; detail?: unknown } = {}) {
    super(message);
    this.name = "ExecutableError";
    this.retryable = opts.retryable ?? false;
    this.detail = opts.detail;
  }
}
