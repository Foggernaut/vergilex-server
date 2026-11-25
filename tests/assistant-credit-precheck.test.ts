// Zero-credit users must not trigger unpaid (Opus) brain runs. The EventSource
// GET's 402 is invisible to the browser, which then falls back to the buffered
// POST — so the balance pre-check has to run at ticket issuance AND before the
// brain call on the buffered start / follow-up paths.
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../src/middleware/auth.js';

const brain = vi.hoisted(() => ({ assistantAnswer: vi.fn(), assistantAnswerStream: vi.fn() }));

vi.mock('../src/brain/brain.client.js', () => ({ brainClient: brain }));
vi.mock('../src/config/supabase.js', async () => {
  const { fakeSupabase } = await import('./helpers/fakeSupabase.js');
  return { supabaseAdmin: fakeSupabase, supabaseAnon: {} };
});
vi.mock('../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/middleware/auth.js', async (orig) => {
  const real = await orig<typeof AuthModule>();
  return {
    ...real,
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as unknown as { user: unknown }).user = { id: 'broke', role: 'user', email: 'a@b.co' };
      next();
    },
  };
});

import { assistantRouter } from '../src/modules/assistant/assistant.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { _resetStreamTicketsForTest } from '../src/modules/assistant/streamTicket.js';
import { fakeSupabase as fake } from './helpers/fakeSupabase.js';

const app = express();
app.use(express.json());
app.use('/api/assistant', assistantRouter);
app.use(errorHandler);

const QUERY = { query: 'Kat karşılığı inşaatta KDV doğar mı?', answer_length: 'long' };

beforeEach(() => {
  vi.clearAllMocks();
  _resetStreamTicketsForTest();
  fake.reset();
  fake.seed('users', [{ id: 'broke', role: 'user', credits: 0 }]);
  fake.seed('assistant_conversations', [
    { id: 'conv-1', user_id: 'broke', filters: null, total_credits_used: 20, deleted_at: null },
  ]);
});

describe('assistant balance pre-check (zero credits)', () => {
  it('stream-ticket → 402 and no ticket is issued', async () => {
    const res = await request(app).post('/api/assistant/conversations/stream-ticket').send(QUERY);
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(res.body.ticket).toBeUndefined();
    expect(brain.assistantAnswerStream).not.toHaveBeenCalled();
  });

  it('buffered POST /conversations → 402 without calling the brain', async () => {
    const res = await request(app).post('/api/assistant/conversations').send(QUERY);
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(brain.assistantAnswer).not.toHaveBeenCalled();
    expect(fake.rows('assistant_conversations')).toHaveLength(1);
  });

  it('buffered follow-up → 402 without calling the brain', async () => {
    const res = await request(app).post('/api/assistant/conversations/conv-1/follow-up').send(QUERY);
    expect(res.status).toBe(402);
    expect(brain.assistantAnswer).not.toHaveBeenCalled();
  });

  it('a user who can afford it still gets a ticket', async () => {
    fake.reset();
    fake.seed('users', [{ id: 'broke', role: 'user', credits: 20 }]);
    const res = await request(app).post('/api/assistant/conversations/stream-ticket').send(QUERY);
    expect(res.status).toBe(201);
    expect(typeof res.body.ticket).toBe('string');
  });
});
