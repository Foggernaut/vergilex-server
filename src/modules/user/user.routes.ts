import { Router } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { exportLimiter } from '../../middleware/rateLimit.js';
import {
  acceptTerms,
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
userRouter.get('/me/export', exportLimiter, exportMyData);
userRouter.delete('/me', deleteMyAccount);
// KVKK md.10: güncel aydınlatma metni + koşulların kabulü (requireAuth 428'inden muaf)
userRouter.post('/me/accept-terms', acceptTerms);
