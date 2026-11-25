// KVKK erase must not trip the shared circuit breaker: failed account deletions
// during an audit-DB blip must never open the breaker for ALL answer traffic.
// Erase failure = network error, non-2xx (older brains: 503) or 200 + ok:false.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('undici', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, request: mocks.request };
});
vi.mock('../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { BrainClient } from '../src/brain/brain.client.js';
import { BrainErasureError, BrainUnavailableError } from '../src/brain/brain.errors.js';

const res = (status: number, json: unknown) => ({
  statusCode: status,
  body: { json: async () => json, dump: async () => undefined },
});
const ERASE = { request_ids: ['r1'], user_id: 'u1' };
const ANSWER = { query: 'KDV oranı nedir?' };
const ANSWER_OK = {
  answer: 'x',
  sources: [],
  conflicts: [],
  confidence_score: 0.5,
  tokens_used: { prompt: 1, completion: 1 },
  not_found: false,
  secondary_legislation_note: null,
};

let client: BrainClient;
const reachedBrain = () => mocks.request.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
  client = new BrainClient({ baseUrl: 'http://brain.test', apiKey: 'k', timeoutMs: 1000 });
});

describe('eraseAuditTrail failure semantics', () => {
  it('200 + ok:true resolves with the counts', async () => {
    mocks.request.mockResolvedValue(res(200, { ok: true, requests_deleted: 3, feedback_deleted: 1 }));
    await expect(client.eraseAuditTrail(ERASE)).resolves.toMatchObject({ ok: true, requests_deleted: 3 });
  });

  it('200 + ok:false (new brain) is a failure, even without counts in the body', async () => {
    mocks.request.mockResolvedValue(res(200, { ok: false, error: 'audit db down' }));
    await expect(client.eraseAuditTrail(ERASE)).rejects.toBeInstanceOf(BrainErasureError);
  });

  it('non-2xx (older brain 503) is a failure', async () => {
    mocks.request.mockResolvedValue(res(503, {}));
    await expect(client.eraseAuditTrail(ERASE)).rejects.toBeInstanceOf(BrainUnavailableError);
  });

  it('a network error is a failure', async () => {
    mocks.request.mockRejectedValue(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    await expect(client.eraseAuditTrail(ERASE)).rejects.toBeInstanceOf(BrainUnavailableError);
  });
});

describe('erase bypasses circuit-breaker accounting', () => {
  it('many failed erasures do not open the breaker for answer traffic', async () => {
    mocks.request.mockResolvedValue(res(200, { ok: false, error: 'blip' }));
    for (let i = 0; i < 10; i++) await expect(client.eraseAuditTrail(ERASE)).rejects.toThrow();
    mocks.request.mockResolvedValue(res(200, ANSWER_OK));
    await expect(client.answerV2(ANSWER)).resolves.toMatchObject({ answer: 'x' });
  });

  it('erase is still attempted while the breaker is open', async () => {
    mocks.request.mockResolvedValue(res(503, {}));
    for (let i = 0; i < 5; i++) await expect(client.answerV2(ANSWER)).rejects.toThrow();
    const before = reachedBrain();
    await expect(client.answerV2(ANSWER)).rejects.toThrow(); // breaker open → short-circuited
    expect(reachedBrain()).toBe(before);
    mocks.request.mockResolvedValue(res(200, { ok: true, requests_deleted: 1, feedback_deleted: 0 }));
    await expect(client.eraseAuditTrail(ERASE)).resolves.toMatchObject({ ok: true });
    expect(reachedBrain()).toBe(before + 1);
  });

  it('a failed post() counts once toward the threshold (4 failures keep it closed, the 5th opens it)', async () => {
    mocks.request.mockResolvedValue(res(503, {}));
    for (let i = 0; i < 4; i++) await expect(client.answerV2(ANSWER)).rejects.toThrow();
    expect(reachedBrain()).toBe(4);
    await expect(client.answerV2(ANSWER)).rejects.toThrow(); // 5th still reaches the brain
    expect(reachedBrain()).toBe(5);
    await expect(client.answerV2(ANSWER)).rejects.toThrow(); // now open
    expect(reachedBrain()).toBe(5);
  });
});
