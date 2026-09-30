// Shared helpers for Baha Ready Edge Functions (Deno).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const APP_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim());

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'MAINTENANCE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  MAINTENANCE: 503,
  INTERNAL: 500,
};

export class HttpError extends Error {
  constructor(
    public code: ErrorCode,
    public messageKey: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed =
    APP_ORIGINS.includes(origin) ||
    /^https:\/\/baha-ready-3d(-[a-z0-9-]+)?\.vercel\.app$/.test(origin) ||
    origin === 'capacitor://localhost' ||
    origin === 'https://localhost';
  return {
    'Access-Control-Allow-Origin': allowed ? origin : APP_ORIGINS[0]!,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(
  req: Request,
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

export function errorResponse(req: Request, e: unknown) {
  const err = e instanceof HttpError ? e : new HttpError('INTERNAL', 'errors.internal');
  if (!(e instanceof HttpError)) console.error('[fn] unhandled', (e as Error)?.message);
  const headers: Record<string, string> = {
    ...corsHeaders(req),
    'Content-Type': 'application/json',
  };
  if (err.extra.retry_after) headers['Retry-After'] = String(err.extra.retry_after);
  return new Response(
    JSON.stringify({
      data: null,
      error: { code: err.code, message: err.messageKey, ...err.extra },
    }),
    { status: STATUS[err.code], headers },
  );
}

/** Wrap a handler with CORS preflight + error envelope. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
    if (req.method !== 'POST')
      return errorResponse(req, new HttpError('NOT_FOUND', 'errors.not_found'));
    try {
      return await handler(req);
    } catch (e) {
      return errorResponse(req, e);
    }
  });
}

let admin: SupabaseClient | undefined;
export function adminClient() {
  admin ??= createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Verifies the caller's JWT with Supabase Auth and returns the user + claims. */
export async function requireUser(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token === ANON_KEY)
    throw new HttpError('UNAUTHENTICATED', 'errors.unauthenticated');
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new HttpError('UNAUTHENTICATED', 'errors.unauthenticated');
  const claims = data.claims as Record<string, unknown> & { sub: string };
  if (claims.user_status && claims.user_status !== 'active')
    throw new HttpError('FORBIDDEN', 'errors.suspended');
  return { userId: claims.sub, claims, client };
}

let redis: Redis | undefined;
const limiters = new Map<string, Ratelimit>();
type Win = `${number} ${'s' | 'm' | 'h' | 'd'}`;

/** Upstash sliding-window rate limit (thresholds mirror system_settings.rate_limits). */
export async function rateLimit(action: string, key: string, limit: number, window: Win) {
  const url = Deno.env.get('UPSTASH_REDIS_REST_URL');
  const tok = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !tok) return;
  redis ??= new Redis({ url, token: tok });
  const id = `${action}:${limit}:${window}`;
  let l = limiters.get(id);
  if (!l) {
    l = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: `rl:${action}`,
    });
    limiters.set(id, l);
  }
  const r = await l.limit(key);
  if (!r.success) {
    throw new HttpError('RATE_LIMITED', 'errors.rate_limited', {
      retry_after: Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)),
    });
  }
}

/** Server → client broadcast over Realtime (REST). */
export async function broadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
  isPrivate = true,
) {
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages: [{ topic, event, payload, private: isPrivate }] }),
    });
  } catch {
    // best-effort
  }
}
