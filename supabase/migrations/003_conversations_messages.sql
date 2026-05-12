-- 003_conversations_messages.sql

CREATE TABLE IF NOT EXISTS public.conversations (
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

CREATE INDEX IF NOT EXISTS idx_conv_user_updated
  ON public.conversations(user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS conversations_set_updated_at ON public.conversations;
CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    role              TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content           TEXT NOT NULL,
    sources           JSONB,
    conflicts         JSONB,
    confidence_score  REAL,
    not_found         BOOLEAN NOT NULL DEFAULT FALSE,
    credits_used      INTEGER NOT NULL DEFAULT 0,
    tokens_used       JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_conv_created
  ON public.messages(conversation_id, created_at ASC);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conv_select_own ON public.conversations;
CREATE POLICY conv_select_own ON public.conversations
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS conv_update_own ON public.conversations;
CREATE POLICY conv_update_own ON public.conversations
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS msg_select_via_conv ON public.messages;
CREATE POLICY msg_select_via_conv ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()
    )
  );
