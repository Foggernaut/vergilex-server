// SECURITY P0: the EventSource assistant stream must never carry the Supabase JWT
// or the user's question in the URL (edge/proxy access logs record full URLs).
// Flow: POST /conversations/stream-ticket (Bearer, body) → opaque single-use
// ticket → GET /conversations/stream?ticket=… (EventSource).
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../src/middleware/auth.js';

const stream = vi.hoisted(() => ({ streamAssistantChat: vi.fn() }));
const getUser = vi.hoisted(() => vi.fn());

vi.mock('../src/modules/assistant/assistant.stream.service.js', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, streamAssistantChat: stream.streamAssistantChat };
});
vi.mock('../src/config/supabase.js', async () => {
  const { fakeSupabase } = await import('./helpers/fakeSupabase.js');
  return { supabaseAdmin: Object.assign(fakeSupabase, { auth: { getUser } }), supabaseAnon: {} };
});
vi.mock('../src/middleware/auth.js', async (orig) => {
  const real = await orig<typeof AuthModule>();
  return {
    ...real,
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as unknown as { user: unknown }).user = { id: 'u1', role: 'user' };
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

const QUERY = 'Kat karşılığı inşaatta KDV doğar mı? Müşterim TCKN 12345678901';

beforeEach(() => {
  vi.clearAllMocks();
  _resetStreamTicketsForTest();
  fake.reset();
  fake.seed('users', [{ id: 'u1', role: 'user', credits: 100 }]);
  stream.streamAssistantChat.mockImplementation(async (_input, sse: { res?: express.Response }) => {
    const res = (sse as unknown as { res: express.Response }).res;
    res.end();
  });
});

async function issue(body: Record<string, unknown> = { query: QUERY, answer_length: 'long' }) {
  return request(app).post('/api/assistant/conversations/stream-ticket').send(body);
}

describe('assistant stream ticket', () => {
  it('issues an opaque ticket that does not embed the query or user id', async () => {
    const res = await issue();
    expect(res.status).toBe(201);
    expect(typeof res.body.ticket).toBe('string');
    expect(res.body.ticket.length).toBeGreaterThanOrEqual(40);
    expect(res.body.ticket).not.toContain('u1');
    expect(Buffer.from(res.body.ticket, 'base64url').toString()).not.toContain('Kat');
    expect(res.body.expires_in).toBe(60);
  });

  it('validates the ticket body with the normal assistant schema', async () => {
    const res = await issue({ query: 'x' });
    expect(res.status).toBe(400);
  });

  it('GET with a valid ticket streams for the ticket owner with the stored params', async () => {
    const { body } = await issue({
      query: QUERY,
      answer_length: 'long',
      filters: { corpora: ['kanun', 'danistay'] },
    });
    const res = await request(app).get(`/api/assistant/conversations/stream?ticket=${body.ticket}`);
    expect(res.status).toBe(200);
    expect(stream.streamAssistantChat).toHaveBeenCalledTimes(1);
    expect(stream.streamAssistantChat.mock.calls[0][0]).toEqual({
      userId: 'u1',
      query: QUERY,
      filters: { corpora: ['kanun', 'danistay'] },
      answer_length: 'long',
    });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('a ticket is single-use (EventSource auto-reconnect cannot re-run the paid pipeline)', async () => {
    const { body } = await issue();
    await request(app).get(`/api/assistant/conversations/stream?ticket=${body.ticket}`);
    const again = await request(app).get(`/api/assistant/conversations/stream?ticket=${body.ticket}`);
    expect(again.status).toBe(401);
    expect(stream.streamAssistantChat).toHaveBeenCalledTimes(1);
  });

  it('an expired ticket is refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { body } = await issue();
      vi.setSystemTime(Date.now() + 61_000);
      const res = await request(app).get(`/api/assistant/conversations/stream?ticket=${body.ticket}`);
      expect(res.status).toBe(401);
      expect(stream.streamAssistantChat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unknown ticket is refused', async () => {
    const res = await request(app).get(
      `/api/assistant/conversations/stream?ticket=${'A'.repeat(43)}`
    );
    expect(res.status).toBe(401);
    expect(stream.streamAssistantChat).not.toHaveBeenCalled();
  });

  it('the legacy ?access_token=&query= form is no longer accepted', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const res = await request(app).get(
      `/api/assistant/conversations/stream?access_token=${'x'.repeat(40)}&query=${encodeURIComponent(QUERY)}`
    );
    expect(res.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(stream.streamAssistantChat).not.toHaveBeenCalled();
  });
});
