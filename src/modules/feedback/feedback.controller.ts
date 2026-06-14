import type { RequestHandler } from 'express';
import { AuthError } from '../../utils/errors.js';
import { messageFeedbackSchema } from './feedback.schema.js';
import { submitMessageFeedback } from './feedback.service.js';

export const submitFeedback: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = messageFeedbackSchema.parse(req.body);
    const result = await submitMessageFeedback({
      userId: req.user.id,
      messageId: input.messageId,
      rating: input.rating,
      note: input.note,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
