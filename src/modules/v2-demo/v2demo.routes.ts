import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rateLimit.js';
import {
  analyzeDocument,
  createV2Chat,
  createV2ChatStream,
  followUpV2Chat,
  followUpV2ChatStream,
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

// SSE streaming variants — masked progress + typewriter reveal. Same auth +
// rate limit + persistence; buffered routes above stay as the fallback.
v2DemoRouter.post('/conversations/stream', aiLimiter, createV2ChatStream);
v2DemoRouter.post('/conversations/:id/follow-up/stream', aiLimiter, followUpV2ChatStream);

// Document analysis — stateless (writes a search_history row).
v2DemoRouter.post('/analyze', aiLimiter, upload.single('file'), analyzeDocument);
