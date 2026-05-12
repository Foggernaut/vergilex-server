import type { RequestHandler } from 'express';
import { logger } from '../config/logger.js';

export const requestLog: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
      userId: req.user?.id,
    });
  });
  next();
};
