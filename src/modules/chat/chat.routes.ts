import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rateLimit.js';
import {
  createChat,
  deleteChat,
  followUpChat,
  getChat,
  listChats,
} from './chat.controller.js';

export const chatRouter = Router();

chatRouter.use(requireAuth);

chatRouter.post('/', aiLimiter, createChat);
chatRouter.post('/:id/follow-up', aiLimiter, followUpChat);
chatRouter.get('/conversations', listChats);
chatRouter.get('/conversations/:id', getChat);
chatRouter.delete('/conversations/:id', deleteChat);
