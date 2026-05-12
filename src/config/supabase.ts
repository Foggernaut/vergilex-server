import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { env } from './env.js';

// Node 20 lacks native WebSocket; @supabase/realtime-js requires one even though
// we never open realtime channels. Supply `ws` so client construction succeeds.
// The `as any` is intentional — ws and lib.dom WebSocket types don't structurally match
// (different ErrorEvent shapes) but the runtime contract is fine.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const realtime: any = { transport: WebSocket };

export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime,
  }
);

export const supabaseAnon: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime,
  }
);
