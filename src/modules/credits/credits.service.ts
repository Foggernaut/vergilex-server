import { supabaseAdmin } from '../../config/supabase.js';
import { InsufficientCreditsError } from '../../utils/errors.js';

export interface DeductResult {
  newBalance: number;
  transactionId: string;
}

/**
 * Atomically deduct credits via the `deduct_credits` SQL function.
 * Throws InsufficientCreditsError on balance shortfall.
 */
export async function deductCredits(args: {
  userId: string;
  amount: number;
  type: 'chat' | 'follow_up' | 'doc_finder';
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<DeductResult> {
  const { data, error } = await supabaseAdmin.rpc('deduct_credits', {
    p_user_id: args.userId,
    p_amount: args.amount,
    p_transaction_type: args.type,
    p_description: args.description ?? null,
    p_metadata: args.metadata ?? null,
  });

  if (error) {
    if (error.message.includes('INSUFFICIENT_CREDITS')) {
      throw new InsufficientCreditsError();
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('deduct_credits returned no rows');
  return {
    newBalance: row.new_balance as number,
    transactionId: row.transaction_id as string,
  };
}

export async function grantCredits(args: {
  userId: string;
  amount: number;
  type: 'admin_grant' | 'refund' | 'signup_bonus';
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<DeductResult> {
  const { data, error } = await supabaseAdmin.rpc('grant_credits', {
    p_user_id: args.userId,
    p_amount: args.amount,
    p_transaction_type: args.type,
    p_description: args.description ?? null,
    p_metadata: args.metadata ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('grant_credits returned no rows');
  return {
    newBalance: row.new_balance as number,
    transactionId: row.transaction_id as string,
  };
}

/**
 * Pre-flight balance check: throw InsufficientCreditsError (402) BEFORE any brain
 * call when the user can't cover `cost`. The buffered routes used to call the brain
 * first and only fail at deductCredits — a 3 Aşamalı run is ~9 min and ~$1 of LLM
 * spend, and the user saw nothing (prod 2026-10-13: EventSource can't read the
 * stream's 402, the web fell back to the buffered route, which ran the full
 * pipeline and then failed at billing).
 */
export async function assertCanAfford(userId: string, cost: number): Promise<void> {
  if (cost <= 0) return;
  const balance = await getBalance(userId);
  if (balance < cost) throw new InsufficientCreditsError();
}

export async function getBalance(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('credits')
    .eq('id', userId)
    .single();
  if (error || !data) throw error ?? new Error('User not found');
  return data.credits;
}

export async function listTransactions(userId: string, limit = 20) {
  const { data, error } = await supabaseAdmin
    .from('credit_transactions')
    .select('id, amount, transaction_type, description, metadata, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
