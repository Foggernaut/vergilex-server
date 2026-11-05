// GET /api/user/claude-budget — admin-only relay of the brain's Claude test budget.
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const brain = vi.hoisted(() => ({ getClaudeBudget: vi.fn() }));
const who = vi.hoisted(() => ({ role: 'user' as 'user' | 'admin' }));

vi.mock('../src/brain/brain.client.js', () => ({ brainClient: brain }));
vi.mock('../src/middleware/auth.js', async (orig) => {
  const real = await orig<typeof import('../src/middleware/auth.js')>();
  return {
    ...real,
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as unknown as { user: unknown }).user = { id: 'u1', role: who.role };
      next();
    },
  };
});

import { userRouter } from '../src/modules/user/user.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use('/api/user', userRouter);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  brain.getClaudeBudget.mockResolvedValue({
    configured: true,
    budget_usd: 100,
    spent_usd: 6.78,
    remaining_usd: 93.22,
    since: '2026-10-12T00:00:00+00:00',
    approximate: true,
  });
});

describe('GET /api/user/claude-budget', () => {
  it('non-admin is refused and the brain is never called', async () => {
    who.role = 'user';
    const res = await request(app).get('/api/user/claude-budget');
    expect(res.status).toBe(401);
    expect(res.body?.error?.code ?? res.body?.code).toBe('FORBIDDEN');
    expect(brain.getClaudeBudget).not.toHaveBeenCalled();
  });

  it('admin gets the brain budget payload', async () => {
    who.role = 'admin';
    const res = await request(app).get('/api/user/claude-budget');
    expect(res.status).toBe(200);
    expect(res.body.remaining_usd).toBe(93.22);
    expect(brain.getClaudeBudget).toHaveBeenCalledTimes(1);
  });
});
