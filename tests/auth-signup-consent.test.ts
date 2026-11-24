// KVKK md.10: kayıt sırasında kabul edilen Kullanım Koşulları / görülen Aydınlatma
// Metni sürümü + zamanı kullanıcı satırına yazılır. Ayrıca: ham e-posta loglanmaz,
// Supabase hata metni istemciye sızmaz (hesap-numaralandırma), auth uçları
// kaba-kuvvete karşı sınırlı.
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/config/logger.js', () => ({ logger: mocks.log }));
vi.mock('../src/config/supabase.js', async () => {
  const { fakeSupabase } = await import('./helpers/fakeSupabase.js');
  return {
    supabaseAdmin: fakeSupabase,
    supabaseAnon: { auth: { signUp: mocks.signUp, signInWithPassword: mocks.signIn } },
  };
});

import { authRouter } from '../src/modules/auth/auth.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { fakeSupabase as fake } from './helpers/fakeSupabase.js';

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api/auth', authRouter);
app.use(errorHandler);

const BODY = {
  email: 'ayse@example.com',
  password: 'cokgizli123',
  full_name: 'Ayşe',
  terms_version: '2026-11-23',
  privacy_notice_version: '2026-11-23',
};

let ip = 0;
const fresh = () => `10.0.${Math.floor(++ip / 250)}.${ip % 250}`;

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  fake.seed('users', [{ id: 'new-user', email: BODY.email }]);
  mocks.signUp.mockResolvedValue({ data: { user: { id: 'new-user', email: BODY.email }, session: null }, error: null });
});

describe('POST /api/auth/signup', () => {
  it('requires the accepted legal versions', async () => {
    const { terms_version: _t, ...noTerms } = BODY;
    const res = await request(app).post('/api/auth/signup').set('X-Forwarded-For', fresh()).send(noTerms);
    expect(res.status).toBe(400);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it('records terms/privacy versions and acceptance time on the user row', async () => {
    const res = await request(app).post('/api/auth/signup').set('X-Forwarded-For', fresh()).send(BODY);
    expect(res.status).toBe(201);
    const upd = fake.callsFor('users').find((c) => (c.op as string) === 'update');
    expect(upd).toBeDefined();
    const payload = upd!.payload as Record<string, unknown>;
    expect(payload.terms_version).toBe('2026-11-23');
    expect(payload.privacy_notice_version).toBe('2026-11-23');
    expect(typeof payload.terms_accepted_at).toBe('string');
    expect(upd!.filters).toContainEqual({ op: 'eq', column: 'id', value: 'new-user' });
  });

  it('logs (error level, user id only) when the acceptance record updates 0 rows — signup still succeeds', async () => {
    fake.reset(); // no public.users row for the new auth user
    const res = await request(app).post('/api/auth/signup').set('X-Forwarded-For', fresh()).send(BODY);
    expect(res.status).toBe(201);
    expect(mocks.log.error).toHaveBeenCalledWith(
      'Signup: legal acceptance not recorded',
      expect.objectContaining({ userId: 'new-user' })
    );
    expect(JSON.stringify(mocks.log.error.mock.calls)).not.toContain('ayse@example.com');
  });

  it('logs when the acceptance update errors — signup still succeeds', async () => {
    fake.failOn('users', 'update', { message: 'column "terms_version" does not exist' });
    const res = await request(app).post('/api/auth/signup').set('X-Forwarded-For', fresh()).send(BODY);
    expect(res.status).toBe(201);
    expect(mocks.log.error).toHaveBeenCalledWith(
      'Signup: legal acceptance not recorded',
      expect.objectContaining({ userId: 'new-user' })
    );
  });

  it('does not log an error when the acceptance record is written', async () => {
    const res = await request(app).post('/api/auth/signup').set('X-Forwarded-For', fresh()).send(BODY);
    expect(res.status).toBe(201);
    expect(mocks.log.error).not.toHaveBeenCalled();
  });

  it('does not leak the Supabase error text or log the raw email', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered', code: 'user_already_exists' },
    });
    const res = await request(app).post('/api/auth/signup').set('X-Forwarded-For', fresh()).send(BODY);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/already registered/i);
    const logged = JSON.stringify(mocks.log.warn.mock.calls);
    expect(logged).not.toContain('ayse@example.com');
  });

  it('keeps the actionable weak-password message', async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Password is too weak', code: 'weak_password' },
    });
    const res = await request(app).post('/api/auth/signup').set('X-Forwarded-For', fresh()).send(BODY);
    expect(res.body.error.code).toBe('WEAK_PASSWORD');
  });
});

describe('auth brute-force limiter', () => {
  it('rate-limits repeated login attempts from one IP', async () => {
    mocks.signIn.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'x' } });
    const addr = fresh();
    let last: request.Response | null = null;
    for (let i = 0; i < 21; i++) {
      last = await request(app).post('/api/auth/login').set('X-Forwarded-For', addr)
        .send({ email: 'a@b.co', password: 'x' });
    }
    expect(last!.status).toBe(429);
  });

  it('successful logins do not consume the budget', async () => {
    mocks.signIn.mockResolvedValue({
      data: { session: { access_token: 't' }, user: { id: 'u', email: 'a@b.co' } },
      error: null,
    });
    const addr = fresh();
    for (let i = 0; i < 25; i++) {
      const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', addr)
        .send({ email: 'a@b.co', password: 'x' });
      expect(res.status).toBe(200);
    }
  });
});
