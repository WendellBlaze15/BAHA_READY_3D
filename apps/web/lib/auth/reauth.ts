import 'server-only';
import { getRedis } from '@/lib/ratelimit';
import { fail } from '@/lib/api/http';

const TTL_SECONDS = 5 * 60;

/** Marks the user as freshly re-authenticated (step-up) for 5 minutes. */
export async function markReauthenticated(userId: string) {
  await getRedis().set(`reauth:${userId}`, Date.now(), { ex: TTL_SECONDS });
}

/** Throws FORBIDDEN(errors.reauth_required) unless the user re-authenticated in the last 5 min. */
export async function requireRecentReauth(userId: string) {
  const v = await getRedis().get(`reauth:${userId}`);
  if (!v) throw fail('FORBIDDEN', 'errors.reauth_required');
}

/** Step-up is single-use for the most sensitive actions. */
export async function consumeReauth(userId: string) {
  await requireRecentReauth(userId);
  await getRedis().del(`reauth:${userId}`);
}
