import { assertSameOrigin, fail, json, route } from '@/lib/api/http';
import { requireStaff } from '@/lib/auth/staff';
import { consumeReauth } from '@/lib/auth/reauth';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { gameServer } from '@/lib/survival/server';

export const runtime = 'nodejs';

/** Force close (super admin + fresh re-auth). The room saves before closing. Audited. */
export const POST = route<{ params: Promise<{ roomId: string }> }>(async (req, ctx) => {
  assertSameOrigin(req);
  const { userId, claims } = await requireStaff('survival.rooms.force_close');
  await consumeReauth(userId);
  const { roomId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) throw fail('NOT_FOUND', 'errors.not_found');
  await gameServer(`/admin/rooms/${roomId}/close`);
  await getSupabaseAdmin().from('audit_logs').insert({
    actor_id: userId,
    actor_role: claims.user_role,
    action: 'force_close:survival_room',
    target_type: 'survival_room',
    target_id: roomId,
  });
  return json({ ok: true });
});
