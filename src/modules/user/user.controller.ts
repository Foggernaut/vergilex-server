import type { RequestHandler } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { AuthError, NotFoundError } from '../../utils/errors.js';
import { getBalance, listTransactions } from '../credits/credits.service.js';

const updateProfileSchema = z.object({
  full_name: z.string().min(1).max(120),
});

export const getProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, role, credits, created_at, updated_at')
      .eq('id', req.user.id)
      .single();
    if (error || !data) throw new NotFoundError('Kullanıcı bulunamadı');
    res.json({ user: data });
  } catch (err) {
    next(err);
  }
};

export const updateProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = updateProfileSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ full_name: input.full_name })
      .eq('id', req.user.id)
      .select('id, email, full_name, role, credits, created_at, updated_at')
      .single();
    if (error || !data) throw error ?? new NotFoundError();
    res.json({ user: data });
  } catch (err) {
    next(err);
  }
};

export const getCredits: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const [balance, transactions] = await Promise.all([
      getBalance(req.user.id),
      listTransactions(req.user.id, 20),
    ]);
    res.json({ balance, transactions });
  } catch (err) {
    next(err);
  }
};

export const getHistory: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const userId = req.user.id;
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const BASE_COLS = 'id, query, search_type, filters, results_count, created_at';
    // `cols` is typed `string` (not a literal) so both calls share one loose
    // row type — lets us reassign on the fallback path below.
    const run = (cols: string) =>
      supabaseAdmin
        .from('search_history')
        .select(cols)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

    let { data, error } = await run(`${BASE_COLS}, conversation_id`);
    // Graceful degradation: if conversation_id hasn't been migrated (012) yet,
    // selecting it errors with undefined_column — retry without it so Geçmiş
    // still loads (rows just won't be clickable).
    if (error && (error.code === '42703' || error.code === 'PGRST204')) {
      ({ data, error } = await run(BASE_COLS));
    }
    if (error) throw error;
    res.json({ history: data ?? [] });
  } catch (err) {
    next(err);
  }
};
