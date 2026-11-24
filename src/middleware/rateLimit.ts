import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Çok fazla istek, lütfen bekleyin' } },
});

// Stricter limiter for AI endpoints (chat, doc-finder)
export const aiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
  message: { error: { code: 'RATE_LIMITED', message: 'AI istek limiti aşıldı' } },
});

// E-posta gönderimi — kötüye kullanıma karşı kullanıcı başına saatte 10 istek.
export const mailLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
  message: { error: { code: 'RATE_LIMITED', message: 'E-posta gönderim limiti aşıldı, lütfen sonra tekrar deneyin' } },
});

// Login / signup — brute-force & credential-stuffing guard: 20 attempts / 15 min per IP.
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Çok fazla deneme, lütfen 15 dakika sonra tekrar deneyin' } },
});

// KVKK veri dışa aktarma (GET /api/user/me/export) — her çağrı kullanıcının bütün
// verisini okur: kullanıcı başına saatte 5. Mounted after requireAuth, so the key
// is the user id; the IP fallback is never hit in practice. (express-rate-limit 7.x
// has no IPv6 keyGenerator validation — on a v8 upgrade wrap it in ipKeyGenerator.)
export const exportLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
  message: { error: { code: 'RATE_LIMITED', message: 'Veri dışa aktarma limiti aşıldı, lütfen bir saat sonra tekrar deneyin' } },
});
