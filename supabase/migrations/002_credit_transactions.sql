-- 002_credit_transactions.sql

CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    amount            INTEGER NOT NULL,
    transaction_type  TEXT NOT NULL CHECK (transaction_type IN (
                        'chat', 'follow_up', 'doc_finder',
                        'signup_bonus', 'admin_grant', 'refund'
                      )),
    description       TEXT,
    metadata          JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_txn_user
  ON public.credit_transactions(user_id, created_at DESC);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_txn_select_own ON public.credit_transactions;
CREATE POLICY credit_txn_select_own ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id);
