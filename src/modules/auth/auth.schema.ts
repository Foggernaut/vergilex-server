import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  full_name: z.string().min(1).max(120).optional(),
  // KVKK md.10 kaydı: kabul edilen Kullanım Koşulları / görülen Aydınlatma Metni sürümü.
  terms_version: z.string().min(1).max(40),
  privacy_notice_version: z.string().min(1).max(40),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
