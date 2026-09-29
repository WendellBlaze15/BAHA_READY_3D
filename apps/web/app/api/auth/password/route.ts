import { passwordSignInSchema, USERNAME_RE } from '@baha/shared/auth';
import { assertSameOrigin, clientIp, fail, json, parseBody, route } from '@/lib/api/http';
import { rateLimit } from '@/lib/ratelimit';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { nextStepAfterSignIn } from '@/lib/auth/post-signin';

export const runtime = 'nodejs';

const INVALID = () =>
  fail('VALIDATION_ERROR', 'errors.invalid_credentials', {
    fields: { password: 'errors.invalid_credentials' },
  });

/** Resolve a username to its account email (server-side only; never returned to the client). */
async function resolveEmail(identifier: string) {
  if (identifier.includes('@')) return identifier.toLowerCase();
  if (!USERNAME_RE.test(identifier)) return null;
  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('username', identifier)
    .maybeSingle();
  if (!profile) return null;
  const { data } = await admin.auth.admin.getUserById(profile.id);
  return data.user?.email ?? null;
}

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = await parseBody(req, passwordSignInSchema);
  if (body.website) throw INVALID();

  await rateLimit('password_signin', `ip:${clientIp(req)}`);
  await rateLimit('password_signin', `id:${body.identifier.toLowerCase()}`);

  const email = await resolveEmail(body.identifier);
  if (!email) throw INVALID();

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: body.password,
  });
  if (error || !data.session) {
    if (error?.status === 429)
      throw fail('RATE_LIMITED', 'errors.rate_limited', { retry_after: 60 });
    throw INVALID();
  }
  const next = new URL(req.url).searchParams.get('next');
  return json(nextStepAfterSignIn(data.session, next));
});
