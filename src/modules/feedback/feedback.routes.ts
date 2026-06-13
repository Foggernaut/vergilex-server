import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { submitFeedback } from './feedback.controller.js';

export const feedbackRouter = Router();

feedbackRouter.use(requireAuth);

// 0 credits — feedback is free.
feedbackRouter.post('/', submitFeedback);
