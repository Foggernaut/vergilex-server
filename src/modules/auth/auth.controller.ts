import type { RequestHandler } from 'express';
import { supabaseAdmin, supabaseAnon } from '../../config/supabase.js';
import { loginSchema, signupSchema } from './auth.schema.js';
import { AuthError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';

/** a***@example.com — enough to correlate support tickets, not a raw identifier. */
function maskEmail(email: string): string {
  const [u, d] = email.split('@');
  return d ? `${(u ?? '').slice(0, 1)}***@${d}` : '***';
}

export const signup: RequestHandler = async (req, res, next) => {
  try {
    const { email, password, full_name, terms_version, privacy_notice_version } =
      signupSchema.parse(req.body);

    const { data, error } = await supabaseAnon.auth.signUp({
      email,
      password,
      options: { data: full_name ? { full_name } : {} },
    });

    if (error) {
      // SECURITY: no raw email in logs; never echo Supabase's message (it reveals
      // whether an account exists → enumeration). Only actionable codes pass.
      logger.warn('Signup failed', { email: maskEmail(email), code: error.code ?? 'unknown' });
      if (error.code === 'weak_password') {
        throw new AuthError('Şifre yeterince güçlü değil; daha uzun ve tahmin edilmesi zor bir şifre seçin.', 'WEAK_PASSWORD');
      }
      throw new AuthError('Kayıt tamamlanamadı. Bilgilerinizi kontrol edip tekrar deneyin.', 'SIGNUP_FAILED');
    }
    if (!data.user) throw new AuthError('Kayıt başarısız', 'SIGNUP_FAILED');

    // KVKK md.10: hangi metin sürümünün ne zaman kabul edildiğini kaydet (migration 023).
    const { error: consentErr } = await supabaseAdmin
      .from('users')
      .update({ terms_version, privacy_notice_version, terms_accepted_at: new Date().toISOString() })
      .eq('id', data.user.id);
    if (consentErr) {
      logger.error('Signup: legal acceptance not recorded', { userId: data.user.id, err: consentErr.message });
    }

    res.status(201).json({
      user: { id: data.user.id, email: data.user.email },
      session: data.session,
    });
  } catch (err) {
    next(err);
  }
};

export const login: RequestHandler = async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      throw new AuthError('E-posta veya şifre hatalı', 'LOGIN_FAILED');
    }
    res.json({
      user: { id: data.user?.id, email: data.user?.email },
      session: data.session,
    });
  } catch (err) {
    next(err);
  }
};

export const logout: RequestHandler = async (req, res, next) => {
  try {
    const header = req.header('authorization');
    if (header?.toLowerCase().startsWith('bearer ')) {
      const token = header.slice(7).trim();
      await supabaseAdmin.auth.admin.signOut(token).catch(() => undefined);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

export const me: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, role, credits, created_at')
      .eq('id', req.user.id)
      .single();
    if (error || !data) throw new AuthError('Profil bulunamadı', 'PROFILE_NOT_FOUND');
    res.json({ user: data });
  } catch (err) {
    next(err);
  }
};
