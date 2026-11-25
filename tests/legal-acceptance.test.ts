// KVKK md.10: güncel aydınlatma metni + kullanım koşulları kabul edilmeden hizmet
// uçları 428 döner (gerçek requireAuth ile); hesap yönetimi (profil, kabul, dışa
// aktarma, silme) her zaman açıktır; kabul yalnız GÜNCEL sürümle kaydedilir.
import express, { Router } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.hoisted(() => vi.fn());
vi.mock('../src/config/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../src/brain/brain.client.js', () => ({ brainClient: {} }));
vi.mock('../src/config/supabase.js', async () => {
  const { fakeSupabase } = await import('./helpers/fakeSupabase.js');
  return { supabaseAdmin: Object.assign(fakeSupabase, { auth: { getUser } }), supabaseAnon: {} };
});

import { requireAuth } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { userRouter } from '../src/modules/user/user.routes.js';
import { LEGAL_VERSIONS } from '../src/modules/legal/legal.js';
import { fakeSupabase as fake } from './helpers/fakeSupabase.js';

// A stand-in service router, wired exactly like the real ones (router.use(requireAuth)).
const service = Router();
service.use(requireAuth);
service.get('/ping', (_req, res) => {
  res.json({ ok: true });
});

const app = express();
app.use(express.json());
app.use('/api/user', userRouter);
app.use('/api/chat', service);
app.use(errorHandler);

const AUTH = { Authorization: 'Bearer tok' };
const base = { id: 'u1', email: 'a@b.co', full_name: null, role: 'user', credits: 10, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };

beforeEach(() => {
  fake.reset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.co' } }, error: null });
});

describe('KVKK legal acceptance gate', () => {
  it('blocks service routes with 428 when there is no acceptance record', async () => {
    fake.seed('users', [{ ...base, terms_version: null, privacy_notice_version: null, terms_accepted_at: null }]);
    const r = await request(app).get('/api/chat/ping').set(AUTH);
    expect(r.status).toBe(428);
    expect(r.body.error.code).toBe('TERMS_ACCEPTANCE_REQUIRED');
  });

  it('blocks users who accepted an older version', async () => {
    fake.seed('users', [{ ...base, terms_version: '2000-01-01', privacy_notice_version: LEGAL_VERSIONS.privacy_notice_version }]);
    const r = await request(app).get('/api/chat/ping').set(AUTH);
    expect(r.status).toBe(428);
  });

  it('keeps account management open and reports the consent fields on the profile', async () => {
    fake.seed('users', [{ ...base, terms_version: null, privacy_notice_version: null, terms_accepted_at: null }]);
    const r = await request(app).get('/api/user/profile').set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: 'u1', terms_version: null, privacy_notice_version: null, terms_accepted_at: null });
  });

  it('refuses to record acceptance of a version other than the current one (409)', async () => {
    fake.seed('users', [{ ...base, terms_version: null, privacy_notice_version: null, terms_accepted_at: null }]);
    const r = await request(app)
      .post('/api/user/me/accept-terms')
      .set(AUTH)
      .send({ terms_version: '1999-01-01', privacy_notice_version: LEGAL_VERSIONS.privacy_notice_version });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('LEGAL_VERSION_MISMATCH');
    const row = fake.rows('users').find((u) => u.id === 'u1');
    expect(row?.terms_version).toBeNull();
  });

  it('records the current versions and then lets the user through', async () => {
    fake.seed('users', [{ ...base, terms_version: null, privacy_notice_version: null, terms_accepted_at: null }]);
    const r = await request(app).post('/api/user/me/accept-terms').set(AUTH).send({ ...LEGAL_VERSIONS });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ ...LEGAL_VERSIONS });
    expect(typeof r.body.user.terms_accepted_at).toBe('string');

    const after = await request(app).get('/api/chat/ping').set(AUTH);
    expect(after.status).toBe(200);
  });

  it('does not block when the DB has no consent columns (migration 023 not applied)', async () => {
    fake.seed('users', [{ ...base }]);
    const r = await request(app).get('/api/chat/ping').set(AUTH);
    expect(r.status).toBe(200);
    const p = await request(app).get('/api/user/profile').set(AUTH);
    expect(p.body.user).not.toHaveProperty('terms_version');
  });
});
