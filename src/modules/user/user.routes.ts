import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import {
  deleteMyAccount,
  exportMyData,
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
// KVKK md.11: erişim/taşınabilirlik + silme hakkı
userRouter.get('/me/export', exportMyData);
userRouter.delete('/me', deleteMyAccount);
