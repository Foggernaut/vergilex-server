import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`vergilex-server listening`, {
    port: env.PORT,
    env: env.NODE_ENV,
    brainUrl: env.BRAIN_API_URL,
  });
});

const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('Forced shutdown');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
