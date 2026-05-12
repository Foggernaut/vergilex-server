-- 004_favorites.sql
-- Caches full DocumentResult snapshot so detail view works without a brain doc-by-id endpoint.

CREATE TABLE IF NOT EXISTS public.favorites (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    chunk_id      TEXT NOT NULL,
    source_type   TEXT NOT NULL CHECK (source_type IN ('chunk', 'table', 'ozelge', 'soru_cevap', 'footnote')),
    cached_data   JSONB NOT NULL,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_fav_user_created
  ON public.favorites(user_id, created_at DESC);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fav_select_own ON public.favorites;
CREATE POLICY fav_select_own ON public.favorites
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS fav_insert_own ON public.favorites;
CREATE POLICY fav_insert_own ON public.favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS fav_delete_own ON public.favorites;
CREATE POLICY fav_delete_own ON public.favorites
  FOR DELETE USING (auth.uid() = user_id);
