import express, { type Express, type RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { corsOrigins } from './config/env.js';
import { brainClient } from './brain/brain.client.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLog } from './middleware/requestLog.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { userRouter } from './modules/user/user.routes.js';
import { chatRouter } from './modules/chat/chat.routes.js';
import { documentsRouter } from './modules/documents/documents.routes.js';
import { favoritesRouter } from './modules/favorites/favorites.routes.js';
import { v2DemoRouter } from './modules/v2-demo/v2demo.routes.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(requestLog);

  // Health
  const healthHandler: RequestHandler = async (_req, res) => {
    const result: { status: string; brain: 'ok' | 'unreachable' } = {
      status: 'ok',
      brain: 'unreachable',
    };
    try {
      await brainClient.health();
      result.brain = 'ok';
    } catch (err) {
      logger.warn('Brain health check failed', { err: err instanceof Error ? err.message : err });
    }
    res.json(result);
  };
  app.get('/health', healthHandler);

  app.use('/api', generalLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api/user', userRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/belge-bul', documentsRouter);
  app.use('/api/favorites', favoritesRouter);
  app.use('/api/v2-demo', v2DemoRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Bulunamadı' } });
  });

  app.use(errorHandler);

  return app;
}
