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
