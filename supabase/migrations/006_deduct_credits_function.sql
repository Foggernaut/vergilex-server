-- 006_deduct_credits_function.sql
-- Atomic credit deduction: checks balance, deducts, logs transaction.
-- Raises 'INSUFFICIENT_CREDITS' if balance is too low.

CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id          UUID,
  p_amount           INTEGER,
  p_transaction_type TEXT,
  p_description      TEXT DEFAULT NULL,
  p_metadata         JSONB DEFAULT NULL
)
RETURNS TABLE (new_balance INTEGER, transaction_id UUID) AS $$
DECLARE
  v_current INTEGER;
  v_new INTEGER;
  v_txn_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  SELECT credits INTO v_current
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  IF v_current < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  v_new := v_current - p_amount;

  UPDATE public.users
  SET credits = v_new, updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata)
  VALUES (p_user_id, -p_amount, p_transaction_type, p_description, p_metadata)
  RETURNING id INTO v_txn_id;

  RETURN QUERY SELECT v_new, v_txn_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant credits (admin / signup bonus / refund)
CREATE OR REPLACE FUNCTION public.grant_credits(
  p_user_id          UUID,
  p_amount           INTEGER,
  p_transaction_type TEXT,
  p_description      TEXT DEFAULT NULL,
  p_metadata         JSONB DEFAULT NULL
)
RETURNS TABLE (new_balance INTEGER, transaction_id UUID) AS $$
DECLARE
  v_new INTEGER;
  v_txn_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT';
  END IF;

  UPDATE public.users
  SET credits = credits + p_amount, updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credits INTO v_new;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  INSERT INTO public.credit_transactions (user_id, amount, transaction_type, description, metadata)
  VALUES (p_user_id, p_amount, p_transaction_type, p_description, p_metadata)
  RETURNING id INTO v_txn_id;

  RETURN QUERY SELECT v_new, v_txn_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
