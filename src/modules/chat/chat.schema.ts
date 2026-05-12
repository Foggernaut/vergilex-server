import { z } from 'zod';
import { AnswerLengthSchema } from '../../brain/brain.types.js';

export const filtersSchema = z
  .object({
    law_id: z.string().nullable().optional(),
  })
  .optional();

export const newChatSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: filtersSchema,
  answer_length: AnswerLengthSchema.optional(),
});

export const followUpSchema = z.object({
  query: z.string().min(2).max(1000),
  answer_length: AnswerLengthSchema.optional(),
});

export type NewChatInput = z.infer<typeof newChatSchema>;
export type FollowUpInput = z.infer<typeof followUpSchema>;
