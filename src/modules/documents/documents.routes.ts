import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rateLimit.js';
import { findDocuments, getDocumentHistory, getSavedResults } from './documents.controller.js';

export const documentsRouter = Router();

documentsRouter.use(requireAuth);
documentsRouter.post('/', aiLimiter, findDocuments);
documentsRouter.get('/history', getDocumentHistory);
documentsRouter.get('/history/:id/results', getSavedResults);
