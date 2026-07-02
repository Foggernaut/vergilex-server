-- 014_assistant.sql
-- Mevzuat Asistanı (Opus 4.8 agentic tab) — dedicated conversation/message
-- tables, isolated from the existing chat (conversations/messages) so the new
-- paid feature can't leak into "Mevzuat Sohbet" history. Mirrors 003 + the
-- message telemetry columns added by later migrations (cost_usd, brain_request_id,
-- answer_length, feedback_rating).

CREATE TABLE IF NOT EXISTS public.assistant_conversations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title               TEXT,
    initial_query       TEXT NOT NULL,
    filters             JSONB,
    total_credits_used  INTEGER NOT NULL DEFAULT 0,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asistan_conv_user_updated
  ON public.assistant_conversations(user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS assistant_conversations_set_updated_at ON public.assistant_conversations;
CREATE TRIGGER assistant_conversations_set_updated_at
  BEFORE UPDATE ON public.assistant_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.assistant_messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
    role              TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content           TEXT NOT NULL,
    sources           JSONB,
    conflicts         JSONB,
    confidence_score  REAL,
    not_found         BOOLEAN NOT NULL DEFAULT FALSE,
    credits_used      INTEGER NOT NULL DEFAULT 0,
    tokens_used       JSONB,
    cost_usd          NUMERIC,
    answer_length     TEXT,
    brain_request_id  TEXT,
    feedback_rating   INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asistan_msg_conv_created
  ON public.assistant_messages(conversation_id, created_at ASC);

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asistan_conv_select_own ON public.assistant_conversations;
CREATE POLICY asistan_conv_select_own ON public.assistant_conversations
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS asistan_conv_update_own ON public.assistant_conversations;
CREATE POLICY asistan_conv_update_own ON public.assistant_conversations
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS asistan_msg_select_via_conv ON public.assistant_messages;
CREATE POLICY asistan_msg_select_via_conv ON public.assistant_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.assistant_conversations c
      WHERE c.id = assistant_messages.conversation_id AND c.user_id = auth.uid()
    )
  );
