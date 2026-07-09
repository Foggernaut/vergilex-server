import type { RequestHandler } from 'express';
import { AppError, AuthError } from '../../utils/errors.js';
import { isMailConfigured, sendAnswerPdf } from '../../services/mailer.js';
import { emailAnswerSchema } from './export.schema.js';

/**
 * Client-side üretilen cevap PDF'ini giriş yapan kullanıcının KENDİ e-postasına
 * gönderir. Alıcı yalnız req.user.email — istemci adres belirleyemez (spam relay
 * önlemi). PDF, multipart `pdf` alanında gelir; boyut/mime multer + burada denetlenir.
 */
export const emailAnswerPdf: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    // Özellik henüz açılmadıysa (env set edilmedi) erken 503.
    if (!isMailConfigured()) {
      throw new AppError(503, 'MAIL_DISABLED', 'E-posta gönderimi yakında aktif olacak');
    }

    const file = (req as { file?: Express.Multer.File }).file;
    if (!file) throw new AppError(400, 'NO_FILE', 'PDF dosyası yüklenmedi');
    if (file.mimetype !== 'application/pdf') {
      throw new AppError(400, 'UNSUPPORTED_MIME', 'Sadece PDF dosyası gönderilebilir');
    }

    const input = emailAnswerSchema.parse({
      fileName: req.body?.fileName,
      question: typeof req.body?.question === 'string' ? req.body.question : undefined,
    });

    await sendAnswerPdf(req.user.email, {
      fileName: input.fileName,
      pdf: file.buffer,
      question: input.question,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
