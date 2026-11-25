import { brainClient } from '../../brain/brain.client.js';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { AppError, AuthError, NotFoundError } from '../../utils/errors.js';
import { deleteAccount, exportUserData } from './privacy.service.js';
import { getBalance, listTransactions } from '../credits/credits.service.js';
import { LEGAL_VERSIONS, toProfile } from '../legal/legal.js';

const updateProfileSchema = z.object({
  full_name: z.string().min(1).max(120),
});

const acceptTermsSchema = z.object({
  terms_version: z.string().min(1).max(40),
  privacy_notice_version: z.string().min(1).max(40),
});

export const getProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    // `*` + toProfile: consent columns included when migration 023 exists.
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single();
    if (error || !data) throw new NotFoundError('Kullanıcı bulunamadı');
    res.json({ user: toProfile(data as Record<string, unknown>) });
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
      .select('*')
      .single();
    if (error || !data) throw error ?? new NotFoundError();
    res.json({ user: toProfile(data as Record<string, unknown>) });
  } catch (err) {
    next(err);
  }
};

/**
 * KVKK md.10: records acceptance of the CURRENT privacy notice + terms. The
 * client sends the versions it displayed; a mismatch (stale tab / web and server
 * out of sync) is refused so we never record acceptance of a text not shown.
 */
export const acceptTerms: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = acceptTermsSchema.parse(req.body);
    if (
      input.terms_version !== LEGAL_VERSIONS.terms_version ||
      input.privacy_notice_version !== LEGAL_VERSIONS.privacy_notice_version
    ) {
      throw new AppError(
        409,
        'LEGAL_VERSION_MISMATCH',
        'Metinlerin güncel sürümü farklı. Sayfayı yenileyip tekrar deneyin.'
      );
    }
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ ...LEGAL_VERSIONS, terms_accepted_at: new Date().toISOString() })
      .eq('id', req.user.id)
      .select('*')
      .single();
    if (error || !data) throw new AppError(500, 'ACCEPT_FAILED', 'Kabul kaydedilemedi');
    res.json({ user: toProfile(data as Record<string, unknown>) });
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

/** Admin-only: Claude test bütçesinden kalan tutar (Beyin /v2/budget, yaklaşık). */
export const getClaudeBudget: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await brainClient.getClaudeBudget());
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

// ── KVKK md.11 veri sahibi hakları ──────────────────────────────────────────

/** GET /api/user/me/export — kullanıcının tüm verisi (JSON, indirilebilir). */
export const exportMyData: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const data = await exportUserData(req.user.id);
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="vergilex-verilerim-${day}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const deleteAccountSchema = z.object({
  confirm_email: z.string().trim().min(3).max(320),
});

/** DELETE /api/user/me — hesabı ve tüm verileri kalıcı olarak siler (e-posta onayı ister). */
export const deleteMyAccount: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { confirm_email } = deleteAccountSchema.parse(req.body ?? {});
    if (confirm_email.toLowerCase() !== (req.user.email ?? '').trim().toLowerCase()) {
      throw new AppError(400, 'CONFIRMATION_MISMATCH', 'Onay için hesabınızın e-posta adresini yazın.');
    }
    await deleteAccount(req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
