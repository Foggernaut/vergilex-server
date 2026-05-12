import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rateLimit.js';
import { findDocuments } from './documents.controller.js';

export const documentsRouter = Router();

documentsRouter.use(requireAuth);
documentsRouter.post('/', aiLimiter, findDocuments);
