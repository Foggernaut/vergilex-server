import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getSourceFullText } from './sourceText.controller.js';

// Kaynak modalindeki "Tam metni görüntüle" için brain /v2/document pass-through.
// Auth-gated, no credit cost (no LLM behind it); app-wide generalLimiter only —
// the stricter aiLimiter would choke a browsing action.
export const sourceTextRouter = Router();

sourceTextRouter.use(requireAuth);
sourceTextRouter.get('/', getSourceFullText);
