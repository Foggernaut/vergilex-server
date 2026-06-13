import { z } from 'zod';

// Thumbs feedback on an assistant message. rating mirrors the brain scale:
// 5 = 👍 (helpful), 1 = 👎 (not helpful). Only these two values are accepted.
export const messageFeedbackSchema = z.object({
  messageId: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(5)]),
  note: z.string().max(1000).optional(),
});

export type MessageFeedbackInput = z.infer<typeof messageFeedbackSchema>;
