-- 007_add_cost_telemetry.sql
-- Per-message USD cost and answer-length from brain v2.
-- cost_usd is the indexed projection of the full breakdown stored in messages.tokens_used.cost (JSONB).

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS cost_usd REAL,
  ADD COLUMN IF NOT EXISTS answer_length TEXT
    CHECK (answer_length IN ('short', 'medium', 'long'));

CREATE INDEX IF NOT EXISTS idx_msg_cost
  ON public.messages(conversation_id, cost_usd DESC)
  WHERE cost_usd IS NOT NULL;
