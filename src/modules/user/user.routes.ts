import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getCredits, getHistory, getProfile, updateProfile } from './user.controller.js';

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.get('/profile', getProfile);
userRouter.patch('/profile', updateProfile);
userRouter.get('/credits', getCredits);
userRouter.get('/history', getHistory);
