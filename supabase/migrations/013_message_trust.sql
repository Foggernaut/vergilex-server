-- 013_message_trust.sql
-- DEFERRED / OPTIONAL — the app does NOT require this to function. The trust
-- signal already reaches the client in-memory from the brain response on each
-- live turn (see chat.service.ts). Applying this migration only adds PERSISTENCE
-- so the trust band also shows when reloading OLD conversations from history.
-- After applying, re-enable the trust_* keys in the messages insert + select.
--
-- B12.6 composite trust signal from brain v2, persisted per assistant message.
-- trust_score (0..1) is the discriminative answer-quality score the client now
-- surfaces as the user-facing % (vs the raw cross-encoder confidence_score).
-- trust_band ∈ HIGH | MEDIUM | LOW | REJECT. All nullable: legacy v1 rows carry none.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS trust_band TEXT
    CHECK (trust_band IN ('HIGH', 'MEDIUM', 'LOW', 'REJECT')),
  ADD COLUMN IF NOT EXISTS trust_score REAL,
  ADD COLUMN IF NOT EXISTS trust_explanation TEXT;
