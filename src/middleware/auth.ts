import type { RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { AuthError } from '../utils/errors.js';
import type { AuthUser } from '../modules/auth/auth.types.js';

/**
 * Verifies a Supabase access token from the Authorization header
 * and attaches { id, email, role } to req.user.
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

    // Load profile to determine role
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      throw new AuthError('Profil bulunamadı');
    }

    const user: AuthUser = {
      id: data.user.id,
      email: data.user.email ?? '',
      role: profile.role as 'user' | 'admin',
    };
    req.user = user;
    next();
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
