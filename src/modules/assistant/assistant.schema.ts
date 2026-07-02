import { z } from 'zod';

export const newAssistantChatSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: z
    .object({
      law_id: z.string().nullable().optional(),
      // 3-katman asistan korpus seçimi (kanun/bdk/danistay/ozelge/soru_cevap/
      // makale/ansiklopedi). Boş/eksik = tüm korpuslar taranır.
      corpora: z.array(z.string()).optional(),
    })
    .optional(),
  answer_length: z.enum(['short', 'medium', 'long']).optional(),
});

export const assistantFollowUpSchema = z.object({
  query: z.string().min(2).max(1000),
  answer_length: z.enum(['short', 'medium', 'long']).optional(),
});
