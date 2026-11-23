// KVKK md.11 — veri sahibi hakları: GET /api/user/me/export (taşınabilirlik / erişim)
// ve DELETE /api/user/me (silme). Silme sırası: önce brain audit izi, sonra auth
// kullanıcısı (CASCADE). Audit silinemezse hesap SİLİNMEZ (yarım silme yok).
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../src/middleware/auth.js';

const mocks = vi.hoisted(() => ({
  eraseAuditTrail: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('../src/brain/brain.client.js', () => ({
  brainClient: { eraseAuditTrail: mocks.eraseAuditTrail },
}));
vi.mock('../src/config/supabase.js', async () => {
  const { fakeSupabase } = await import('./helpers/fakeSupabase.js');
  return {
    supabaseAdmin: Object.assign(fakeSupabase, { auth: { admin: { deleteUser: mocks.deleteUser } } }),
    supabaseAnon: {},
  };
});
vi.mock('../src/middleware/auth.js', async (orig) => {
  const real = await orig<typeof AuthModule>();
  return {
    ...real,
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as unknown as { user: unknown }).user = { id: 'u1', role: 'user', email: 'a@b.co' };
      next();
    },
  };
});

import { userRouter } from '../src/modules/user/user.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { fakeSupabase as fake } from './helpers/fakeSupabase.js';

const app = express();
app.use(express.json());
app.use('/api/user', userRouter);
app.use(errorHandler);

const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';
const R3 = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  fake.seed('users', [
    { id: 'u1', email: 'A@b.co', full_name: 'Ayşe', role: 'user', credits: 10 },
    { id: 'u2', email: 'x@y.z', full_name: 'Other', role: 'user', credits: 5 },
  ]);
  fake.seed('conversations', [
    { id: 'c1', user_id: 'u1', title: 't1', deleted_at: null },
    { id: 'c2', user_id: 'u1', title: 't2', deleted_at: '2026-11-01T00:00:00Z' },
    { id: 'c9', user_id: 'u2', title: 'other', deleted_at: null },
  ]);
  fake.seed('messages', [
    { id: 'm1', conversation_id: 'c1', role: 'user', content: 'soru', brain_request_id: null },
    { id: 'm2', conversation_id: 'c1', role: 'assistant', content: 'cevap', brain_request_id: R1 },
    { id: 'm3', conversation_id: 'c2', role: 'assistant', content: 'eski', brain_request_id: R2 },
    { id: 'm9', conversation_id: 'c9', role: 'assistant', content: 'başkası', brain_request_id: 'zzz' },
  ]);
  fake.seed('assistant_conversations', [{ id: 'a1', user_id: 'u1', title: 'as' }]);
  fake.seed('assistant_messages', [
    { id: 'am1', conversation_id: 'a1', role: 'assistant', content: 'deneme', brain_request_id: R3 },
  ]);
  fake.seed('credit_transactions', [{ id: 't1', user_id: 'u1', amount: -5 }]);
  fake.seed('favorites', [{ id: 'f1', user_id: 'u1', chunk_id: 'k', notes: 'not' }]);
  fake.seed('search_history', [{ id: 'h1', user_id: 'u1', query: 'q' }]);
  fake.seed('search_results', [{ id: 's1', user_id: 'u1', request: {}, response: {} }]);
  mocks.eraseAuditTrail.mockResolvedValue({ ok: true, requests_deleted: 3, feedback_deleted: 0 });
  mocks.deleteUser.mockResolvedValue({ data: {}, error: null });
});

describe('GET /api/user/me/export', () => {
  it('returns all of the caller’s data (incl. soft-deleted conversations) and nothing of others', async () => {
    const res = await request(app).get('/api/user/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="vergilex-verilerim-/);
    const b = res.body;
    expect(b.profile.email).toBe('A@b.co');
    expect(b.conversations.map((c: { id: string }) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(b.conversations.find((c: { id: string }) => c.id === 'c1').messages).toHaveLength(2);
    expect(b.assistant_conversations[0].messages[0].content).toBe('deneme');
    expect(b.credit_transactions).toHaveLength(1);
    expect(b.favorites).toHaveLength(1);
    expect(b.search_history).toHaveLength(1);
    expect(b.search_results).toHaveLength(1);
    expect(JSON.stringify(b)).not.toContain('başkası');
    expect(JSON.stringify(b)).not.toContain('Other');
  });
});

describe('DELETE /api/user/me', () => {
  it('requires the account email as confirmation', async () => {
    const res = await request(app).delete('/api/user/me').send({ confirm_email: 'wrong@x.y' });
    expect(res.status).toBe(400);
    expect(mocks.eraseAuditTrail).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it('erases the brain audit trail for every brain_request_id, then deletes the auth user', async () => {
    const res = await request(app).delete('/api/user/me').send({ confirm_email: ' a@B.co ' });
    expect(res.status).toBe(204);
    const arg = mocks.eraseAuditTrail.mock.calls[0][0];
    expect(arg.user_id).toBe('u1');
    expect([...arg.request_ids].sort()).toEqual([R1, R2, R3].sort());
    expect(mocks.deleteUser).toHaveBeenCalledWith('u1');
    expect(mocks.eraseAuditTrail.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteUser.mock.invocationCallOrder[0]
    );
  });

  it('does NOT delete the account when audit erasure fails (no half-deletion)', async () => {
    mocks.eraseAuditTrail.mockRejectedValue(new Error('brain down'));
    const res = await request(app).delete('/api/user/me').send({ confirm_email: 'a@b.co' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ERASURE_FAILED');
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it('surfaces an auth-delete failure as 500 after the audit was erased', async () => {
    mocks.deleteUser.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await request(app).delete('/api/user/me').send({ confirm_email: 'a@b.co' });
    expect(res.status).toBe(500);
  });
});
