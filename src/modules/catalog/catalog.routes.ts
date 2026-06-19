import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getCategories, getCategory } from './catalog.controller.js';

// Read-only catalog of everything the RAG can retrieve ("Sistemdeki Belgeler").
// Gated behind auth (test users are logged in); no credit cost. General rate
// limiting is already applied app-wide via app.use('/api', generalLimiter).
export const catalogRouter = Router();

catalogRouter.use(requireAuth);
catalogRouter.get('/categories', getCategories);
catalogRouter.get('/:category', getCategory);
