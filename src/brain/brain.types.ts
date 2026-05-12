import { z } from 'zod';

// Mirrors mevzuat-knowledge-api v2 Pydantic models.

export const BrainDocumentResultSchema = z.object({
  chunk_id: z.string(),
  law_id: z.string(),
  law_name: z.string(),
  madde_no: z.string().nullable(),
  madde_basligi: z.string().nullable(),
  excerpt: z.string(),
  relevance_score: z.number(),
  source_type: z.enum(['chunk', 'table', 'ozelge', 'soru_cevap', 'footnote']),
  law_references: z.array(z.string()),
});
export type BrainDocumentResult = z.infer<typeof BrainDocumentResultSchema>;

export const BrainCostSchema = z.object({
  query_expansion_usd: z.number(),
  answer_generation_usd: z.number(),
  conflict_explanation_usd: z.number().default(0),
  total_usd: z.number(),
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
});
export type BrainCost = z.infer<typeof BrainCostSchema>;

const EMPTY_COST: BrainCost = {
  query_expansion_usd: 0,
  answer_generation_usd: 0,
  conflict_explanation_usd: 0,
  total_usd: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
};

export const AnswerLengthSchema = z.enum(['short', 'medium', 'long']);
export type AnswerLength = z.infer<typeof AnswerLengthSchema>;

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
  cost: BrainCostSchema.default(EMPTY_COST),
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
  answer_length: AnswerLengthSchema.optional(),
});
export type BrainAnswerRequest = z.infer<typeof BrainAnswerRequestSchema>;

export const BrainConflictSchema = z.object({
  description: z.string(),
  chunk_ids: z.array(z.string()),
  // LLM-generated 1-2 sentence context-specific reasoning per conflict.
  // null when explainer was skipped (no conflicts) or failed gracefully.
  explanation: z.string().nullable().optional(),
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
  cost: BrainCostSchema.default(EMPTY_COST),
});
export type BrainAnswerResponse = z.infer<typeof BrainAnswerResponseSchema>;
