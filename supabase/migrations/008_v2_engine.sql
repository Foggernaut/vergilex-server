-- 008_v2_engine.sql
-- Add engine column to conversations + messages so V2 demo conversations live
-- alongside V1 chat in the same tables, and extend search_history to record
-- V2 document analyses.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'v1'
    CHECK (engine IN ('v1', 'v2'));

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'v1'
    CHECK (engine IN ('v1', 'v2'));

CREATE INDEX IF NOT EXISTS idx_conv_user_engine_updated
  ON public.conversations(user_id, engine, updated_at DESC)
  WHERE deleted_at IS NULL;

-- Extend search_history's check to include V2 analyze + V2 chat.
ALTER TABLE public.search_history
  DROP CONSTRAINT IF EXISTS search_history_search_type_check;
ALTER TABLE public.search_history
  ADD CONSTRAINT search_history_search_type_check
    CHECK (search_type IN ('chat', 'doc_finder', 'v2_chat', 'v2_analyze'));
