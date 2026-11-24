-- 024_revoke_authenticated_select.sql
-- SECURITY (2026-11-24): `authenticated` loses SELECT on every public table.
--
-- Why: anyone can obtain an `authenticated` session without our server — call
-- GoTrue signup (/auth/v1/signup) directly with the public anon key that ships in
-- the web bundle. Today every table is RLS own-row, so that session reads only its
-- own rows; but any FUTURE table created without RLS (or with a loose policy)
-- would be readable in full through PostgREST by such a session. 022 kept this
-- SELECT "to keep the door open" — nothing walks through it, so close it.
--
-- Verified before writing (2026-11-24, code grep, branch security/iso27001-kvkk):
--   * vergilex-server: every .from()/.rpc() goes through supabaseAdmin
--     (service_role, bypasses grants + RLS). supabaseAnon is used only for
--     auth.signUp / auth.signInWithPassword (GoTrue, not PostgREST).
--   * vergilex-web/src: only supabase.auth.* (getSession, setSession,
--     onAuthStateChange, signOut, getUser, updateUser) — no .from(), .rpc(),
--     .channel() or realtime subscriptions.
--   So no client reads public tables as `authenticated`.
--
-- service_role is untouched. RLS policies stay as defence in depth.
-- Idempotent; safe to re-run. Apply in the Supabase SQL editor (product project).

BEGIN;

-- ── 0. Guard: PRODUCT project only (qjjbfkifxtpzcapitlvo) ──────────────────
-- Stops BEFORE any change if run in the corpus or audit project by mistake.
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL
     OR to_regclass('public.conversations') IS NULL
     OR to_regclass('public.credit_transactions') IS NULL THEN
    RAISE EXCEPTION 'Wrong Supabase project: run 024 in the PRODUCT project (ref qjjbfkifxtpzcapitlvo), not corpus/audit. Nothing was changed.';
  END IF;
END $$;

-- ── 1. Existing tables ──────────────────────────────────────────────────────
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM authenticated;

-- ── 2. Tables created later (dashboard / future migrations) ────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT ON TABLES FROM authenticated;

COMMIT;

-- ── Verification (run after COMMIT; expect n = 0) ───────────────────────────
-- SELECT count(*) AS n
--   FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
--  WHERE ns.nspname = 'public'
--    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
--    AND has_table_privilege('authenticated', c.oid, 'SELECT');
--
-- Default privileges for future tables (expect no 'authenticated=r' entry):
-- SELECT defaclrole::regrole, defaclobjtype, defaclacl
--   FROM pg_default_acl d JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
--  WHERE ns.nspname = 'public' AND defaclobjtype = 'r';
