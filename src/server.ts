import { Agent, setGlobalDispatcher } from 'undici';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

// ── Outbound (undici) timeout headroom for the slow brain ────────────────────
// The brain buffers whole answers (no response headers until done) up to ~275s
// p95, and holds SSE streams open even longer. undici's DEFAULT headersTimeout
// AND bodyTimeout are both 300_000ms — so without this they would silently cut
// a slow answer BELOW BRAIN_TIMEOUT_MS (the AbortController budget). Match them
// to the brain budget. Global dispatcher = Supabase's fetch shares it, so we
// deliberately do NOT cap `connections` here (a low cap would throttle Supabase);
// raising a ceiling never forces a wait, so this is safe for fast callees.
setGlobalDispatcher(
  new Agent({
    headersTimeout: env.BRAIN_TIMEOUT_MS,
    bodyTimeout: env.BRAIN_TIMEOUT_MS,
    connectTimeout: 10_000,
  })
);

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`vergilex-server listening`, {
    port: env.PORT,
    env: env.NODE_ENV,
    brainUrl: env.BRAIN_API_URL,
    brainTimeoutMs: env.BRAIN_TIMEOUT_MS,
  });
});

// ── Inbound (Node http.Server) timeout headroom ──────────────────────────────
// The client/edge connection stays open for the entire answer — a buffered POST
// (up to ~275s) or a long-lived SSE stream. Node's default requestTimeout of
// 300_000ms would abort exactly those legitimate long requests. Disable the
// request cap and keep the socket warm; headersTimeout stays > keepAliveTimeout.
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

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
