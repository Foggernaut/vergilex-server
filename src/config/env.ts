import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  // Mevzuat RAG Supabase (read-only) — source for the "Sistemdeki Belgeler" catalog.
  // Separate project from the product DB above. Service-role key (bypasses RLS).
  MEVZUAT_SUPABASE_URL: z.string().url(),
  MEVZUAT_SUPABASE_SERVICE_KEY: z.string().min(1),

  BRAIN_API_URL: z.string().url(),
  BRAIN_API_KEY: z.string().min(1),
  // Brain answers are slow: p50 ~90s, p95 ~275s (agent path). The old 300000
  // default sat AT the p95 with zero headroom, and it must clear BOTH the
  // brain's own processing time AND this server's pre-call work (auth + balance
  // read). Raised to 420s (7 min) so a legitimately slow buffered answer isn't
  // killed mid-flight. NOTE: undici's own headersTimeout/bodyTimeout (set in
  // server.ts) and Node's server.requestTimeout must clear this too, else they
  // cut the socket BELOW this budget. Keep all three aligned above ~300s.
  BRAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(420000),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // E-posta gönderimi (Resend) — cevabı kaynakçasıyla PDF eki olarak kullanıcının
  // kendi adresine yollamak için. MAIL_FROM örn: "Vergilex <cevap@mail.vergilex.app>".
  // ŞİMDİLİK OPSİYONEL: ikisi de set edilene kadar e-posta özelliği "yakında"
  // durumundadır (endpoint 503 döner), server yine de açılır.
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  SIGNUP_BONUS_CREDITS: z.coerce.number().int().nonnegative().default(500),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export const corsOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
