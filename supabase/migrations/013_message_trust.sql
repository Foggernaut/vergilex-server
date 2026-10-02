-- 013_message_trust.sql
-- SUPERSEDED BY 016_answer_signals.sql — do not apply this one on its own.
-- 016 re-declares these same three columns (IF NOT EXISTS, so applying both in
-- either order is harmless) AND adds them to `assistant_messages`, which this
-- migration never covered, plus the position_* / degradation_* / clarifying
-- signals. Apply 016; this file is kept only so the numbering stays contiguous.
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
