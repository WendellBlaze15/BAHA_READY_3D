import { z } from 'zod';
import { assertSameOrigin, json, parseBody, route } from '@/lib/api/http';
import { getSupabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const schema = z.object({ scope: z.enum(['local', 'others', 'global']).default('local') }).strict();

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { scope } = await parseBody(req, schema);
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut({ scope });
  return json({ signedOut: scope });
});
