import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { login, logout, me, signup } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/signup', signup);
authRouter.post('/login', login);
authRouter.post('/logout', requireAuth, logout);
authRouter.get('/me', requireAuth, me);
