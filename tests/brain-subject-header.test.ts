// KVKK erasure contract: every brain request made on behalf of a logged-in user
// carries `X-Subject-Id: <user id>` (the brain stores an HMAC of it on each audit
// row). Established by requireAuth via AsyncLocalStorage; the brain client adds
// it in every shared request path (JSON GET/POST, multipart, SSE stream). Calls
// outside any request (jobs) carry no header.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('undici', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, request: mocks.request };
});
vi.mock('../src/config/supabase.js', async () => {
  const { fakeSupabase } = await import('./helpers/fakeSupabase.js');
  return {
    supabaseAdmin: Object.assign(fakeSupabase, { auth: { getUser: mocks.getUser } }),
    supabaseAnon: {},
  };
});
vi.mock('../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createApp } from '../src/app.js';
import { brainClient } from '../src/brain/brain.client.js';
import { purgeDeletedConversations } from '../src/jobs/retention.js';
import { runWithoutSubject, runWithSubject } from '../src/utils/requestContext.js';
import { fakeSupabase as fake } from './helpers/fakeSupabase.js';

const U = '6f1c1d2e-0000-4000-8000-00000000abcd';
const app = createApp();
const auth = { Authorization: 'Bearer good-token' };

function body(json: unknown, chunks: string[] = []) {
  return {
    json: async () => json,
    dump: async () => undefined,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield Buffer.from(c);
    },
  };
}
const jsonRes = (status: number, json: unknown) => ({ statusCode: status, body: body(json) });
const sseRes = (frames: string[]) => ({ statusCode: 200, body: body({}, frames) });

type Opts = { headers?: Record<string, string>; body?: unknown };
const callsTo = (path: string) =>
  mocks.request.mock.calls.filter(([url]) => String(url).includes(path)) as [string, Opts][];
const subjectOf = (path: string) => {
  const calls = callsTo(path);
  expect(calls).toHaveLength(1);
  return calls[0][1].headers?.['x-subject-id'];
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  fake.seed('users', [{ id: U, email: 'a@b.co', role: 'user', credits: 100 }]);
  mocks.getUser.mockResolvedValue({ data: { user: { id: U, email: 'a@b.co' } }, error: null });
});

describe('X-Subject-Id on brain calls made inside an authenticated request', () => {
  it('JSON GET path (tam metin)', async () => {
    mocks.request.mockResolvedValue(jsonRes(200, { source_type: 'kanun', full_text: 'metin' }));
    const res = await request(app)
      .get('/api/tam-metin?source_type=kanun&chunk_id=KDVK-17-C0')
      .set(auth);
    expect(res.status).toBe(200);
    expect(subjectOf('/v2/document')).toBe(U);
  });

  it('SSE stream path — the async generator is consumed in the handler and still sees the store', async () => {
    mocks.request.mockResolvedValue(sseRes(['event: phase\ndata: {"phase":"retrieval"}\n\n']));
    const res = await request(app)
      .post('/api/assistant/conversations/stream')
      .set(auth)
      .send({ query: 'Kat karşılığı inşaatta KDV doğar mı?' });
    expect(res.text).toContain('event: phase');
    expect(subjectOf('/v2/assistant/answer/stream')).toBe(U);
  });

  it('ticket-authenticated EventSource GET (runs before requireAuth) carries the ticket owner', async () => {
    mocks.request.mockResolvedValue(sseRes(['event: phase\ndata: {"phase":"retrieval"}\n\n']));
    const t = await request(app)
      .post('/api/assistant/conversations/stream-ticket')
      .set(auth)
      .send({ query: 'Kat karşılığı inşaatta KDV doğar mı?' });
    expect(t.status).toBe(201);
    expect(mocks.request).not.toHaveBeenCalled();
    const res = await request(app).get(`/api/assistant/conversations/stream?ticket=${t.body.ticket}`);
    expect(res.text).toContain('event: phase');
    expect(subjectOf('/v2/assistant/answer/stream')).toBe(U);
  });

  it('multipart path through multer (next() fired from busboy stream events) keeps the subject', async () => {
    mocks.request.mockResolvedValue(
      jsonRes(200, {
        total_pages: 1,
        total_chars: 5,
        chunk_count: 1,
        detected_concepts: ['kdv'],
        chunks_preview: [],
        file_too_large: false,
        error: null,
      })
    );
    const res = await request(app)
      .post('/api/v2-demo/analyze')
      .set(auth)
      .attach('file', Buffer.from('metin'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(200);
    expect(subjectOf('/v2/analyze-document')).toBe(U);
  });
});

describe('no X-Subject-Id outside a request', () => {
  it('a brain call from a job (no request context) carries no subject header', async () => {
    mocks.request.mockResolvedValue(jsonRes(200, { configured: false }));
    await brainClient.getClaudeBudget();
    const [, opts] = callsTo('/v2/budget')[0];
    expect(opts.headers).not.toHaveProperty('x-subject-id');
    expect(opts.headers?.['x-api-key']).toBeTruthy();
  });

  it('runWithoutSubject drops an ambient subject', async () => {
    mocks.request.mockResolvedValue(jsonRes(200, { configured: false }));
    await runWithSubject(U, () => runWithoutSubject(() => brainClient.getClaudeBudget()));
    expect(callsTo('/v2/budget')[0][1].headers).not.toHaveProperty('x-subject-id');
  });

  it('retention erase never sends a subject (header or body), even if triggered inside a request', async () => {
    fake.seed('conversations', [{ id: 'c-old', user_id: U, deleted_at: '2020-01-01T00:00:00Z' }]);
    fake.seed('messages', [{ id: 'm1', conversation_id: 'c-old', brain_request_id: 'r-1' }]);
    mocks.request.mockResolvedValue(jsonRes(200, { ok: true, requests_deleted: 1, feedback_deleted: 0 }));
    await runWithSubject(U, () => purgeDeletedConversations());
    const [, opts] = callsTo('/v2/privacy/erase')[0];
    expect(opts.headers).not.toHaveProperty('x-subject-id');
    expect(JSON.parse(String(opts.body))).toEqual({ request_ids: ['r-1'] });
  });
});
