import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { NexusError, toNexusError } from '../errors';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function fail(error: unknown) {
  const e = toNexusError(error);
  return NextResponse.json(
    {
      error: {
        code: e.code,
        message: e.message,
        ...(e.details !== undefined ? { details: e.details } : {}),
      },
    },
    { status: e.status },
  );
}

export function validationError(error: ZodError) {
  return NextResponse.json(
    {
      error: {
        code: 'VALIDATION',
        message: 'Request validation failed',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    },
    { status: 422 },
  );
}

/** Wraps a route handler so thrown errors become consistent JSON payloads. */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ZodError) return validationError(error);
      if (error instanceof NexusError || error instanceof Error) {
        console.error('[api]', error.message);
      }
      return fail(error);
    }
  };
}
