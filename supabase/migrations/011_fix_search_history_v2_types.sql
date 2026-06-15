-- 011_fix_search_history_v2_types.sql
--
-- Re-assert the search_history.search_type CHECK constraint so it accepts the
-- V2 values ('v2_chat', 'v2_analyze'). This duplicates the constraint part of
-- migration 008 on purpose: if 008 was only partially applied to a running
-- database (e.g. the `engine` columns landed via another path but this
-- constraint update did not), every V2 chat/analyze INSERT into search_history
-- silently fails the CHECK — the conversation still persists, the brain still
-- returns 200, but the row never reaches the "Geçmiş" page.
--
-- Idempotent: safe to run any number of times.

ALTER TABLE public.search_history
  DROP CONSTRAINT IF EXISTS search_history_search_type_check;

ALTER TABLE public.search_history
  ADD CONSTRAINT search_history_search_type_check
    CHECK (search_type IN ('chat', 'doc_finder', 'v2_chat', 'v2_analyze'));
