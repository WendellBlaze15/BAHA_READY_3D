import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { z } from 'zod';
import { HTTP_STATUS, type ApiError, type ErrorCode } from '@baha/shared/api';

export class HttpError extends Error {
  constructor(
    public code: ErrorCode,
    public messageKey: string,
    public extra: Pick<ApiError, 'fields' | 'retry_after'> = {},
  ) {
    super(code);
  }
}

export const fail = (code: ErrorCode, messageKey?: string, extra?: HttpError['extra']) =>
  new HttpError(code, messageKey ?? `errors.${code.toLowerCase()}`, extra);

export function json<T>(data: T, init?: ResponseInit) {
  return Response.json(
    { data, error: null },
    {
      ...init,
      headers: { 'Cache-Control': 'no-store', ...init?.headers },
    },
  );
}

function errorResponse(err: HttpError) {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (err.extra.retry_after) headers['Retry-After'] = String(err.extra.retry_after);
  return Response.json(
    { data: null, error: { code: err.code, message: err.messageKey, ...err.extra } },
    { status: HTTP_STATUS[err.code], headers },
  );
}

/** CSRF defense for mutating routes: Origin must match this app. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) throw fail('FORBIDDEN', 'errors.forbidden');
  const allowed = new Set<string>([new URL(req.url).origin]);
  if (process.env.NEXT_PUBLIC_APP_URL) allowed.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) allowed.add(`${req.headers.get('x-forwarded-proto') ?? 'https'}://${host}`);
  // Capacitor app shells
  allowed.add('capacitor://localhost');
  allowed.add('https://localhost');
  if (!allowed.has(origin)) throw fail('FORBIDDEN', 'errors.forbidden');
}

/** Client IP: first hop of x-forwarded-for (set by Vercel), else x-real-ip. */
export function clientIp(req: Request) {
  const xff = req.headers.get('x-forwarded-for');
  return (xff?.split(',')[0] ?? req.headers.get('x-real-ip') ?? '0.0.0.0').trim();
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw fail('VALIDATION_ERROR', 'errors.validation');
  }
  const res = schema.safeParse(raw);
  if (!res.success) {
    const fields: Record<string, string> = {};
    for (const issue of res.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??=
        typeof issue.message === 'string' && issue.message.startsWith('errors.')
          ? issue.message
          : 'errors.validation';
    }
    throw fail('VALIDATION_ERROR', 'errors.validation', { fields });
  }
  return res.data;
}

/** Wraps a route handler: consistent envelope, no stack traces to clients. */
export function route<Ctx = unknown>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e);
      Sentry.captureException(e);
      console.error('[api] unhandled error', (e as Error)?.message);
      return errorResponse(fail('INTERNAL', 'errors.internal'));
    }
  };
}
