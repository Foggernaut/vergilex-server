// KVKK saklama: soft-delete edilmiş sohbetler RETENTION_DELETED_CONVERSATION_DAYS
// (30) gün sonra kalıcı silinir; daha yeni silinenler ve aktif sohbetler kalır.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/supabase.js', async () => {
  const { fakeSupabase } = await import('./helpers/fakeSupabase.js');
  return { supabaseAdmin: fakeSupabase };
});
vi.mock('../src/config/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { env } from '../src/config/env.js';
import { purgeDeletedConversations } from '../src/jobs/retention.js';
import { fakeSupabase as fake } from './helpers/fakeSupabase.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 23);
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

beforeEach(() => {
  fake.reset();
  fake.seed('conversations', [
    { id: 'old', user_id: 'u', deleted_at: ago(31) },
    { id: 'recent', user_id: 'u', deleted_at: ago(5) },
    { id: 'live', user_id: 'u', deleted_at: null },
  ]);
  fake.seed('assistant_conversations', [{ id: 'a-old', user_id: 'u', deleted_at: ago(90) }]);
});

describe('purgeDeletedConversations', () => {
  it('hard-deletes only conversations soft-deleted longer than the retention window', async () => {
    const res = await purgeDeletedConversations(NOW);
    expect(res).toEqual({ conversations: 1, assistant_conversations: 1 });
    expect(fake.rows('conversations').map((r) => r.id).sort()).toEqual(['live', 'recent']);
    expect(fake.rows('assistant_conversations')).toHaveLength(0);
  });

  it('is a no-op when retention is disabled (0)', async () => {
    const prev = env.RETENTION_DELETED_CONVERSATION_DAYS;
    (env as { RETENTION_DELETED_CONVERSATION_DAYS: number }).RETENTION_DELETED_CONVERSATION_DAYS = 0;
    try {
      expect(await purgeDeletedConversations(NOW)).toEqual({});
      expect(fake.rows('conversations')).toHaveLength(3);
    } finally {
      (env as { RETENTION_DELETED_CONVERSATION_DAYS: number }).RETENTION_DELETED_CONVERSATION_DAYS = prev;
    }
  });
});
