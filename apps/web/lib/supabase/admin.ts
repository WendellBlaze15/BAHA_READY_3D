import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { publicEnv } from '@/lib/env/client';
import { serverEnv } from '@/lib/env/server';

let adminClient: SupabaseClient<Database> | undefined;

/**
 * Service-role client. BYPASSES RLS — only use in server code after explicit authorization
 * checks, and never pass its results to the client unfiltered.
 */
export function getSupabaseAdmin() {
  adminClient ??= createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return adminClient;
}
