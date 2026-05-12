-- 005_search_history.sql

CREATE TABLE IF NOT EXISTS public.search_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    query           TEXT NOT NULL,
    search_type     TEXT NOT NULL CHECK (search_type IN ('chat', 'doc_finder')),
    filters         JSONB,
    results_count   INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_user_created
  ON public.search_history(user_id, created_at DESC);

ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS history_select_own ON public.search_history;
CREATE POLICY history_select_own ON public.search_history
  FOR SELECT USING (auth.uid() = user_id);
