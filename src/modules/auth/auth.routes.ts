import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { login, logout, me, signup } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/signup', authLimiter, signup);
authRouter.post('/login', authLimiter, login);
authRouter.post('/logout', requireAuth, logout);
authRouter.get('/me', requireAuth, me);
