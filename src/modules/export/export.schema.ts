import { z } from 'zod';

// multipart/form-data metin alanları. PDF dosyası controller'da multer ile
// ayrıca doğrulanır (mime + boyut).
export const emailAnswerSchema = z.object({
  fileName: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => s.toLowerCase().endsWith('.pdf'), 'Geçersiz dosya adı'),
  question: z.string().max(1000).optional(),
});

export type EmailAnswerInput = z.infer<typeof emailAnswerSchema>;
