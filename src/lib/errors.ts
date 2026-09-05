/** Typed application errors with stable machine-readable codes. */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'PERMISSION_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'RATE_LIMITED'
  | 'TOOL_FAILED'
  | 'AGENT_FAILED'
  | 'PROVIDER_ERROR'
  | 'INTERNAL';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,
  PERMISSION_DENIED: 403,
  APPROVAL_REQUIRED: 409,
  RATE_LIMITED: 429,
  TOOL_FAILED: 502,
  AGENT_FAILED: 502,
  PROVIDER_ERROR: 503,
  INTERNAL: 500,
};

export class NexusError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options?: { details?: unknown; retryable?: boolean }) {
    super(message);
    this.name = 'NexusError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options?.details;
    this.retryable = options?.retryable ?? false;
  }
}

export const badRequest = (m: string, d?: unknown) => new NexusError('BAD_REQUEST', m, { details: d });
export const unauthorized = (m = 'Authentication required') => new NexusError('UNAUTHORIZED', m);
export const forbidden = (m = 'Not permitted') => new NexusError('FORBIDDEN', m);
export const notFound = (m = 'Not found') => new NexusError('NOT_FOUND', m);
export const validation = (m: string, d?: unknown) => new NexusError('VALIDATION', m, { details: d });
export const permissionDenied = (m: string, d?: unknown) => new NexusError('PERMISSION_DENIED', m, { details: d });
export const approvalRequired = (m: string, d?: unknown) => new NexusError('APPROVAL_REQUIRED', m, { details: d });

export function toNexusError(err: unknown): NexusError {
  if (err instanceof NexusError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new NexusError('INTERNAL', message);
}
