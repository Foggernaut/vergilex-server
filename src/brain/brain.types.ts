import { z } from 'zod';

// Mirrors mevzuat-knowledge-api Pydantic models.

export const BrainDocumentResultSchema = z.object({
  chunk_id: z.string(),
  law_id: z.string(),
  law_name: z.string(),
  madde_no: z.string(),
  madde_basligi: z.string().nullable(),
  excerpt: z.string(),
  relevance_score: z.number(),
  source_type: z.enum(['chunk', 'table', 'ozelge', 'soru_cevap', 'footnote']),
  law_references: z.array(z.string()),
});
export type BrainDocumentResult = z.infer<typeof BrainDocumentResultSchema>;

export const BrainFiltersSchema = z
  .object({ law_id: z.string().nullable().optional() })
  .optional();

export const BrainFindDocumentsRequestSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: BrainFiltersSchema,
  limit: z.number().int().min(1).max(50).optional().default(20),
});
export type BrainFindDocumentsRequest = z.infer<typeof BrainFindDocumentsRequestSchema>;

export const BrainFindDocumentsResponseSchema = z.object({
  documents: z.array(BrainDocumentResultSchema),
  expanded_queries: z.array(z.string()),
  total_found: z.number().int(),
  search_time_ms: z.number().int(),
  secondary_legislation_note: z.string().nullable(),
});
export type BrainFindDocumentsResponse = z.infer<typeof BrainFindDocumentsResponseSchema>;

export const BrainHistoryItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type BrainHistoryItem = z.infer<typeof BrainHistoryItemSchema>;

export const BrainAnswerRequestSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: BrainFiltersSchema,
  history: z.array(BrainHistoryItemSchema).optional(),
});
export type BrainAnswerRequest = z.infer<typeof BrainAnswerRequestSchema>;

export const BrainConflictSchema = z.object({
  description: z.string(),
  chunk_ids: z.array(z.string()),
});
export type BrainConflict = z.infer<typeof BrainConflictSchema>;

export const BrainAnswerResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(BrainDocumentResultSchema),
  conflicts: z.array(BrainConflictSchema),
  confidence_score: z.number(),
  tokens_used: z.object({
    prompt: z.number().int(),
    completion: z.number().int(),
  }),
  not_found: z.boolean(),
  secondary_legislation_note: z.string().nullable(),
});
export type BrainAnswerResponse = z.infer<typeof BrainAnswerResponseSchema>;
