import { createServer } from 'node:http';
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

// ── Inbound header budget for long questions ─────────────────────────────────
// The assistant stream is an EventSource GET: the question rides in the query
// string (EventSource can't send a body). Soru tavanı 4000 karakter; Türkçe
// karakterler URL'de 6 bayta kodlanır → istek satırı 10–24 KB olabilir. Node'un
// varsayılan 16 KB başlık sınırı bunu 431 ile reddederdi (fallback POST da uzun
// 3 Aşamalı cevaplarda istemci zaman aşımına düşer). 64 KB = 4000 karakter + JWT
// + çerezler için bol pay.
const MAX_HEADER_BYTES = 64 * 1024;

const server = createServer({ maxHeaderSize: MAX_HEADER_BYTES }, app).listen(env.PORT, () => {
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
// 300_000ms would abort exactly those legitimate long requests. Raise it to a
// FINITE value above the brain budget (not 0/disabled) so it follows
// BRAIN_TIMEOUT_MS and still caps a genuinely stuck/slow client instead of
// letting it hold a connection forever. headersTimeout stays > keepAliveTimeout.
server.requestTimeout = env.BRAIN_TIMEOUT_MS + 60_000; // brain budget + margin
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
