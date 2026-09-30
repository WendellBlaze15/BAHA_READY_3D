import { onboardingSchema } from '@baha/shared/auth';
import { assertSameOrigin, fail, json, parseBody, route } from '@/lib/api/http';
import { requireUser } from '@/lib/auth/session';
import { presetAvatarConfig } from '@/lib/avatar/presets';
import { enqueueEmail } from '@/lib/email/outbox';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { supabase, claims, userId } = await requireUser();
  await rateLimit('general', userId);
  const body = await parseBody(req, onboardingSchema);

  const { data: available } = await supabase.rpc('is_username_available', {
    p_username: body.username,
  });
  if (!available) {
    throw fail('CONFLICT', 'errors.validation', { fields: { username: 'errors.username_taken' } });
  }

  const now = new Date().toISOString();
  // RLS + column grants restrict this to the user's own safe columns.
  const { error } = await supabase
    .from('profiles')
    .update({
      username: body.username,
      avatar_key: body.avatarPreset,
      avatar_config: presetAvatarConfig(body.avatarPreset),
      language: body.language,
      barangay: body.barangay || null,
      school: body.school || null,
      is_minor: body.isMinor,
      consent_at: now,
      onboarded_at: now,
    })
    .eq('id', userId);
  if (error) {
    if (error.code === '23505') {
      throw fail('CONFLICT', 'errors.validation', {
        fields: { username: 'errors.username_taken' },
      });
    }
    throw fail('INTERNAL', 'errors.internal');
  }

  // New JWT with onboarded=true (custom access token hook).
  await supabase.auth.refreshSession();

  if (claims.email) {
    await enqueueEmail({
      to: claims.email,
      template: 'welcome',
      userId,
      locale: body.language,
      params: { username: body.username },
    });
  }
  return json({ next: '/home' });
});
