-- 012_search_history_conversation_link.sql
--
-- Link chat-type search_history rows back to their conversation so the Geçmiş
-- page can make them clickable (open the conversation). Nullable: doc_finder
-- and v2_analyze rows have no conversation, and rows written before this
-- migration stay null (and simply render as non-clickable).
--
-- ON DELETE SET NULL: if a conversation is later hard-deleted, the history row
-- survives as a plain (non-clickable) record instead of cascading away.

ALTER TABLE public.search_history
  ADD COLUMN IF NOT EXISTS conversation_id UUID
    REFERENCES public.conversations(id) ON DELETE SET NULL;
