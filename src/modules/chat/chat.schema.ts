import { z } from 'zod';
import { AnswerLengthSchema } from '../../brain/brain.types.js';
import { MAX_QUERY_CHARS, MIN_QUERY_CHARS } from '../../utils/queryLimits.js';

export const filtersSchema = z
  .object({
    law_id: z.string().nullable().optional(),
  })
  .optional();

export const newChatSchema = z.object({
  query: z.string().min(MIN_QUERY_CHARS).max(MAX_QUERY_CHARS),
  filters: filtersSchema,
  answer_length: AnswerLengthSchema.optional(),
});

export const followUpSchema = z.object({
  query: z.string().min(MIN_QUERY_CHARS).max(MAX_QUERY_CHARS),
  answer_length: AnswerLengthSchema.optional(),
});

export type NewChatInput = z.infer<typeof newChatSchema>;
export type FollowUpInput = z.infer<typeof followUpSchema>;
