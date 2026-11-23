-- 022_least_privilege_grants.sql
-- SECURITY P0 (2026-11-23): close client-side write paths into the product DB.
--
-- Live-verified before this migration (zero-effect probes with the public
-- publishable/anon key):
--   * rpc/grant_credits + rpc/deduct_credits were EXECUTABLE by `anon`. Both are
--     SECURITY DEFINER and take an arbitrary p_user_id → anyone holding the
--     public key could mint or drain credits for any account.
--   * anon/authenticated held UPDATE on public.users (incl. `role`, `credits`);
--     with policy users_update_own (USING auth.uid() = id, no column limit) any
--     logged-in user could PATCH themselves to role='admin' / unlimited credits.
--
-- Architecture this relies on (verified in code):
--   * vergilex-server talks to the DB ONLY via supabaseAdmin (service_role,
--     src/config/supabase.ts). The anon client is used solely for
--     auth.signUp / auth.signInWithPassword.
--   * vergilex-web never calls supabase.from()/.rpc() — only supabase.auth.*.
--   So anon/authenticated need no table writes and no RPC execute at all.
--
-- Idempotent; safe to re-run. Apply in the Supabase SQL editor (product project).

BEGIN;

-- ── 1. RPCs: server-only ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.deduct_credits(UUID, INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TEXT, JSONB)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credits(UUID, INTEGER, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TEXT, JSONB)  TO service_role;

-- SECURITY DEFINER functions must pin search_path (object-shadowing hardening).
ALTER FUNCTION public.deduct_credits(UUID, INTEGER, TEXT, TEXT, JSONB) SET search_path = public, pg_temp;
ALTER FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TEXT, JSONB)  SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()  SET search_path = public, pg_temp;

-- Catch-all for any function created out-of-band in the dashboard.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ── 2. Tables: no client writes; anon reads nothing ─────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;
-- authenticated keeps SELECT: harmless (every table is RLS own-row) and keeps
-- the door open for a future direct-read client without re-granting.

REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- ── 3. Same defaults for objects created later (dashboard / future migrations)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── 4. Policies: remove the client-update policies (no client writes exist) ─
-- users_update_own had no column restriction → role/credits self-edit.
-- conv_update_own / asistan_conv_update_own let a client clear deleted_at
-- (undelete). All legitimate updates go through the server (service_role,
-- which bypasses RLS), so these policies only ever served an attacker.
DROP POLICY IF EXISTS users_update_own        ON public.users;
DROP POLICY IF EXISTS conv_update_own         ON public.conversations;
DROP POLICY IF EXISTS asistan_conv_update_own ON public.assistant_conversations;
-- favorites insert/delete are likewise server-only now (grant revoked above).
DROP POLICY IF EXISTS fav_insert_own ON public.favorites;
DROP POLICY IF EXISTS fav_delete_own ON public.favorites;

COMMIT;

-- ── Verification (run after COMMIT; every row must be false) ─────────────────
-- SELECT 'anon exec grant_credits'  AS chk, has_function_privilege('anon','public.grant_credits(uuid,integer,text,text,jsonb)','EXECUTE') AS v
-- UNION ALL SELECT 'auth exec deduct_credits', has_function_privilege('authenticated','public.deduct_credits(uuid,integer,text,text,jsonb)','EXECUTE')
-- UNION ALL SELECT 'auth update users.role',  has_column_privilege('authenticated','public.users','role','UPDATE')
-- UNION ALL SELECT 'auth update users.credits', has_column_privilege('authenticated','public.users','credits','UPDATE')
-- UNION ALL SELECT 'anon select messages',     has_table_privilege('anon','public.messages','SELECT');
