-- 009_message_feedback.sql
-- B12.9 wiring: let end users 👍/👎 an assistant answer.
--
-- brain_request_id : the audited request id the brain returns on the v2 path
--                    (audit_requests.request_id). Needed to forward a vote to
--                    the brain's POST /v2/feedback. NULL for legacy v1 answers.
-- feedback_rating  : the user's vote on this answer. 5 = 👍, 1 = 👎 (mirrors the
--                    brain's rating scale). NULL = not voted. Authoritative store
--                    for UI state; the brain forward is best-effort.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS brain_request_id UUID,
  ADD COLUMN IF NOT EXISTS feedback_rating  SMALLINT CHECK (feedback_rating IN (1, 5));
