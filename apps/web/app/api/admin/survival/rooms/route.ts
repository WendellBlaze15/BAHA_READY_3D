import { json, route } from '@/lib/api/http';
import { requireStaff } from '@/lib/auth/staff';
import { gameServer } from '@/lib/survival/server';

export const runtime = 'nodejs';

/** Live rooms (proxied from the game server; staff with survival.rooms.monitor + aal2). */
export const GET = route(async () => {
  await requireStaff('survival.rooms.monitor');
  return json(
    await gameServer<{ rooms: unknown[]; memory: number }>('/admin/rooms', undefined, 'GET'),
  );
});
