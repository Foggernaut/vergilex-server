import type { RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError, AuthError } from '../utils/errors.js';
import { LEGAL_EXEMPT_BASES, TERMS_REQUIRED_MESSAGE, legalAcceptanceState } from '../modules/legal/legal.js';
import { runWithSubject } from '../utils/requestContext.js';
import type { AuthUser } from '../modules/auth/auth.types.js';

/**
 * Verifies a Supabase access token from the Authorization header
 * and attaches { id, email, role, legal } to req.user.
 *
 * KVKK md.10: a user who has not accepted the CURRENT privacy notice + terms
 * gets 428 TERMS_ACCEPTANCE_REQUIRED on every router except LEGAL_EXEMPT_BASES
 * (auth + account management: accept, export, delete). Secure by default — a new
 * router is gated without extra wiring.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.header('authorization');
    if (!header?.toLowerCase().startsWith('bearer ')) {
      throw new AuthError('Yetkilendirme başlığı eksik');
    }
    const token = header.slice(7).trim();
    if (!token) throw new AuthError('Geçersiz token');

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      throw new AuthError('Geçersiz veya süresi dolmuş oturum');
    }

    // Load profile: role + KVKK acceptance columns. `*` (not a column list) so a
    // DB without migration 023 still authenticates (legal state → 'unknown').
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      throw new AuthError('Profil bulunamadı');
    }

    const user: AuthUser = {
      id: data.user.id,
      email: data.user.email ?? '',
      role: profile.role as 'user' | 'admin',
      legal: legalAcceptanceState(profile as Record<string, unknown>),
    };
    req.user = user;
    if (user.legal === 'required' && !LEGAL_EXEMPT_BASES.has(req.baseUrl)) {
      throw new AppError(428, 'TERMS_ACCEPTANCE_REQUIRED', TERMS_REQUIRED_MESSAGE);
    }
    // Every brain call made while handling this request carries X-Subject-Id
    // (KVKK erasure by user) — see utils/requestContext.ts.
    runWithSubject(user.id, () => next());
  } catch (err) {
    next(err);
  }
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'admin') {
    next(new AuthError('Yönetici erişimi gerekli', 'FORBIDDEN'));
    return;
  }
  next();
};
