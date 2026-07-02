import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rateLimit.js';
import {
  createAssistantChat,
  createAssistantChatStream,
  createAssistantChatStreamGET,
  deleteAssistant,
  followUpAssistantChat,
  followUpAssistantChatStream,
  getAssistant,
  listAssistant,
} from './assistant.controller.js';

export const assistantRouter = Router();

// EventSource SSE endpoint — MUST be before requireAuth (EventSource can't send
// the Authorization header; it authenticates via ?access_token in the handler).
assistantRouter.get('/conversations/stream', createAssistantChatStreamGET);

assistantRouter.use(requireAuth);

// Mevzuat Asistanı (Opus 4.8 agentic, paid). Dedicated assistant_* tables.
assistantRouter.post('/conversations', aiLimiter, createAssistantChat);
assistantRouter.post('/conversations/stream', aiLimiter, createAssistantChatStream);
assistantRouter.post('/conversations/:id/follow-up', aiLimiter, followUpAssistantChat);
assistantRouter.post('/conversations/:id/follow-up/stream', aiLimiter, followUpAssistantChatStream);

assistantRouter.get('/conversations', listAssistant);
assistantRouter.get('/conversations/:id', getAssistant);
assistantRouter.delete('/conversations/:id', deleteAssistant);
