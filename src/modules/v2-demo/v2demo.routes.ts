import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rateLimit.js';
import {
  analyzeDocument,
  createV2Chat,
  followUpV2Chat,
} from './v2demo.controller.js';

// Mevzuat-knowledge-api v2/analyze-document accepts max 10MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

export const v2DemoRouter = Router();

v2DemoRouter.use(requireAuth);

// Persisted V2 conversations — same shape as /api/chat, but engine='v2'.
v2DemoRouter.post('/conversations', aiLimiter, createV2Chat);
v2DemoRouter.post('/conversations/:id/follow-up', aiLimiter, followUpV2Chat);

// Document analysis — stateless (writes a search_history row).
v2DemoRouter.post('/analyze', aiLimiter, upload.single('file'), analyzeDocument);
