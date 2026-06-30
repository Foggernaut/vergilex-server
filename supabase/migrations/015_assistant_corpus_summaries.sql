-- 015_assistant_corpus_summaries.sql
-- Mevzuat Asistanı 3-layer output: store Katman 2 (per-corpus generalizations)
-- on the assistant answer row. Katman 1 = `sources`, Katman 3 = `content` (essay).
-- Idempotent.

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS corpus_summaries JSONB;
