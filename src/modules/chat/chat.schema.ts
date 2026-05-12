import { z } from 'zod';

export const filtersSchema = z
  .object({
    law_id: z.string().nullable().optional(),
  })
  .optional();

export const newChatSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: filtersSchema,
});

export const followUpSchema = z.object({
  query: z.string().min(2).max(1000),
});

export type NewChatInput = z.infer<typeof newChatSchema>;
export type FollowUpInput = z.infer<typeof followUpSchema>;
