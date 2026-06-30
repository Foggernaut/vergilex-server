-- 014_message_context_reset.sql
-- takip-tespit (follow-up vs new-context classification) persistent boundary.
--
-- When the brain classifies a follow-up turn as a NEW topic (not a continuation),
-- it returns context_reset=true. We mark that on the user message starting the new
-- topic. On subsequent follow-ups, history is loaded only from the most recent
-- context_reset=true message onward (see loadHistorySinceBoundary in
-- chat.service.ts), so a topic the user pivoted away from never re-pollutes the
-- brain's retrieval anchoring / synthesis context.
--
-- context_reset : true on the user message that opened a new topic. Default false
--                 (every existing/legacy row is treated as "no boundary").

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS context_reset BOOLEAN NOT NULL DEFAULT false;

-- Partial index makes the per-conversation "latest boundary" lookup O(index) and
-- stays tiny (only boundary rows are indexed).
CREATE INDEX IF NOT EXISTS messages_context_reset_idx
  ON public.messages (conversation_id, created_at DESC)
  WHERE context_reset;
