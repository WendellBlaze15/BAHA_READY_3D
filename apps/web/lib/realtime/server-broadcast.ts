import 'server-only';
import { publicEnv } from '@/lib/env/client';
import { serverEnv } from '@/lib/env/server';

/** Server → client Realtime broadcast (private topics respect Realtime Authorization). */
export async function serverBroadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown> = {},
  isPrivate = true,
) {
  const key = serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic, event, payload, private: isPrivate }] }),
  }).catch(() => undefined);
}
