import type { RequestHandler } from 'express';
import { supabaseAdmin, supabaseAnon } from '../../config/supabase.js';
import { loginSchema, signupSchema } from './auth.schema.js';
import { AuthError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';

export const signup: RequestHandler = async (req, res, next) => {
  try {
    const { email, password, full_name } = signupSchema.parse(req.body);

    const { data, error } = await supabaseAnon.auth.signUp({
      email,
      password,
      options: { data: full_name ? { full_name } : {} },
    });

    if (error) {
      logger.warn('Signup failed', { email, error: error.message });
      throw new AuthError(error.message, 'SIGNUP_FAILED');
    }
    if (!data.user) throw new AuthError('Kayıt başarısız', 'SIGNUP_FAILED');

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
