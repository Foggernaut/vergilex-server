import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import {
  getClaudeBudget,
  getCredits,
  getHistory,
  getProfile,
  updateProfile,
} from './user.controller.js';

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.get('/profile', getProfile);
userRouter.patch('/profile', updateProfile);
userRouter.get('/credits', getCredits);
userRouter.get('/history', getHistory);
userRouter.get('/claude-budget', requireAdmin, getClaudeBudget);
