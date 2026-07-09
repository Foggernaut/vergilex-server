import { Resend } from 'resend';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';

/** Her iki Resend env'i de set edilmişse e-posta özelliği aktiftir. */
export function isMailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

// Resend istemcisi lazy kurulur — env henüz set edilmemişken (özellik "yakında")
// server açılışta patlamasın.
let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new AppError(503, 'MAIL_DISABLED', 'E-posta gönderimi yakında aktif olacak');
  }
  if (!resendClient) resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SendAnswerPdfOpts {
  fileName: string;
  pdf: Buffer;
  /** Kullanıcının sorusu — konu ve gövdede kullanılır (opsiyonel). */
  question?: string;
}

/**
 * Cevap PDF'ini kullanıcının kendi e-postasına (to) eklenti olarak gönderir.
 * Alıcı çağıran controller tarafından req.user.email'den verilir — istemci adres
 * belirleyemez.
 */
export async function sendAnswerPdf(to: string, opts: SendAnswerPdfOpts): Promise<void> {
  const q = opts.question?.trim();
  const subject = q ? `Vergilex — ${q.slice(0, 120)}` : 'Vergilex — Mevzuat Cevabı';
  const html = `
    <div style="font-family:Georgia,serif;color:#1a1a1a;line-height:1.6">
      <p style="font-weight:bold;letter-spacing:2px;color:#111">VERGİLEX</p>
      <p>${
        q
          ? `<strong>${escapeHtml(q)}</strong> sorunuza ilişkin cevabı kaynakçasıyla birlikte ekteki PDF'te bulabilirsiniz.`
          : `Talep ettiğiniz mevzuat cevabını kaynakçasıyla birlikte ekteki PDF'te bulabilirsiniz.`
      }</p>
      <p style="color:#8a7f70;font-size:13px">Bu e-posta Vergilex tarafından otomatik olarak gönderilmiştir.</p>
    </div>`.trim();

  if (!isMailConfigured()) {
    throw new AppError(503, 'MAIL_DISABLED', 'E-posta gönderimi yakında aktif olacak');
  }

  const { error } = await getResend().emails.send({
    from: env.MAIL_FROM as string,
    to,
    subject,
    html,
    attachments: [{ filename: opts.fileName, content: opts.pdf }],
  });

  if (error) {
    logger.error('Resend e-posta gönderimi başarısız', { err: error.message, to });
    throw new AppError(502, 'MAIL_SEND_FAILED', 'E-posta gönderilemedi, lütfen tekrar deneyin');
  }
}
