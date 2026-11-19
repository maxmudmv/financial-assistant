import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getServerEnv } from '../config/env.js';

let adminClient: SupabaseClient | null = null;

/**
 * Returns a server-only Supabase client authenticated with the service role key.
 * NEVER import this module into frontend `src/` bundles.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) {
    return adminClient;
  }

  const env = getServerEnv();
  adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'X-Client-Info': 'finora-serverless/0.1.0',
      },
    },
  });

  return adminClient;
}
