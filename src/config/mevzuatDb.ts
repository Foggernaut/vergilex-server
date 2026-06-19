import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { env } from './env.js';

// Read-only client for the mevzuat RAG Supabase (separate project from the
// product DB). Backs the "Sistemdeki Belgeler" catalog endpoints. We only ever
// SELECT from the public catalog_* views / catalog_counts materialized view.
//
// Same `ws` realtime shim as config/supabase.ts (Node 20 lacks native WebSocket).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const realtime: any = { transport: WebSocket };

export const mevzuatDb: SupabaseClient = createClient(
  env.MEVZUAT_SUPABASE_URL,
  env.MEVZUAT_SUPABASE_SERVICE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime,
  }
);
