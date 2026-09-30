import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { routing } from './i18n/routing';
import { decide } from './lib/auth/routes';
import type { AppClaims } from './lib/auth/claims';
import { buildCsp, makeNonce } from './lib/security/csp';

const intl = createIntlMiddleware(routing);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Public system flags (maintenance, staff MFA policy), cached for 60s per edge instance.
let flagsCache: { at: number; requireStaffMfa: boolean; maintenance: boolean } | null = null;
async function getFlags() {
  if (flagsCache && Date.now() - flagsCache.at < 60_000) return flagsCache;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/system_settings?select=key,value&key=in.(maintenance,require_staff_mfa)`,
      {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        cache: 'no-store',
      },
    );
    const rows = (await res.json()) as { key: string; value: unknown }[];
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    flagsCache = {
      at: Date.now(),
      // DECISION: fail closed — if the flag can't be read, MFA stays required.
      requireStaffMfa: get('require_staff_mfa') !== false,
      maintenance: !!(get('maintenance') as { enabled?: boolean } | undefined)?.enabled,
    };
  } catch {
    flagsCache = { at: Date.now(), requireStaffMfa: true, maintenance: false };
  }
  return flagsCache;
}

function stripLocale(pathname: string) {
  for (const l of routing.locales) {
    if (pathname === `/${l}`) return { locale: l, path: '/' };
    if (pathname.startsWith(`/${l}/`)) return { locale: l, path: pathname.slice(l.length + 1) };
  }
  return { locale: routing.defaultLocale, path: pathname };
}

export default async function middleware(incoming: NextRequest) {
  // Nonce CSP: Next reads the nonce from the request's CSP header and applies it to its scripts.
  const nonce = makeNonce();
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV !== 'production',
    supabaseUrl: SUPABASE_URL,
  });
  const reqHeaders = new Headers(incoming.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('content-security-policy', csp);
  const request = new NextRequest(incoming, { headers: reqHeaders });

  const response = intl(request);
  response.headers.set('content-security-policy', csp);
  // next-intl redirect (e.g. /fil/x → /x): let it through untouched.
  if (response.headers.get('location')) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Verifies the JWT (and refreshes the session cookie when needed).
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? null) as AppClaims | null;

  const { locale, path } = stripLocale(request.nextUrl.pathname);
  const decision = decide(path, claims, await getFlags());
  if (decision.action === 'allow') return response;

  const prefix = locale === routing.defaultLocale ? '' : `/${locale}`;
  const url = new URL(`${prefix}${decision.to}`, request.url);
  const redirect = NextResponse.redirect(url);
  redirect.headers.set('content-security-policy', csp);
  // Carry refreshed auth cookies onto the redirect.
  for (const c of response.cookies.getAll()) redirect.cookies.set(c);
  return redirect;
}

export const config = {
  // Skip API routes, Next internals, and static files (anything with a dot).
  matcher: ['/((?!api|_next|_vercel|monitoring|.*\\..*).*)'],
};
