// KVKK saklama: soft-delete edilmiş sohbetler RETENTION_DELETED_CONVERSATION_DAYS
// (30) gün sonra kalıcı silinir; daha yeni silinenler ve aktif sohbetler kalır.
// Silinen sohbetin izi de gider: brain audit satırları (YALNIZ request id ile —
// asla user_id ile değil) ve soru metnini taşıyan search_history satırları.
// Audit silme başarısızsa parti atlanır (yarın yeniden denenir), yarım silme olmaz.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ eraseAuditTrail: vi.fn() }));

vi.mock('../src/brain/brain.client.js', () => ({
  brainClient: { eraseAuditTrail: mocks.eraseAuditTrail },
}));
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
const ids = (table: string) => fake.rows(table).map((r) => r.id).sort();
const erasedIds = () => mocks.eraseAuditTrail.mock.calls.flatMap(([a]) => a.request_ids as string[]).sort();

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  fake.seed('conversations', [
    { id: 'c-old', user_id: 'u', deleted_at: ago(31) },
    { id: 'c-old2', user_id: 'u', deleted_at: ago(45) },
    { id: 'c-recent', user_id: 'u', deleted_at: ago(5) },
    { id: 'c-live', user_id: 'u', deleted_at: null },
  ]);
  fake.seed('messages', [
    { id: 'm1', conversation_id: 'c-old', brain_request_id: null },
    { id: 'm2', conversation_id: 'c-old', brain_request_id: 'r-old' },
    { id: 'm3', conversation_id: 'c-old2', brain_request_id: 'r-old2' },
    { id: 'm4', conversation_id: 'c-recent', brain_request_id: 'r-recent' },
    { id: 'm5', conversation_id: 'c-live', brain_request_id: 'r-live' },
  ]);
  fake.seed('search_history', [
    { id: 'h-old', user_id: 'u', query: 'eski soru', conversation_id: 'c-old' },
    { id: 'h-old2', user_id: 'u', query: 'eski soru 2', conversation_id: 'c-old2' },
    { id: 'h-live', user_id: 'u', query: 'canlı soru', conversation_id: 'c-live' },
    { id: 'h-doc', user_id: 'u', query: 'belge bul', conversation_id: null },
  ]);
  fake.seed('assistant_conversations', [
    { id: 'a-old', user_id: 'u', deleted_at: ago(90) },
    { id: 'a-live', user_id: 'u', deleted_at: null },
  ]);
  fake.seed('assistant_messages', [
    { id: 'am1', conversation_id: 'a-old', brain_request_id: 'r-a-old' },
    { id: 'am2', conversation_id: 'a-live', brain_request_id: 'r-a-live' },
  ]);
  mocks.eraseAuditTrail.mockResolvedValue({ ok: true, requests_deleted: 1, feedback_deleted: 0 });
});

describe('purgeDeletedConversations', () => {
  it('hard-deletes only conversations soft-deleted longer than the retention window', async () => {
    const res = await purgeDeletedConversations(NOW);
    expect(res).toEqual({ conversations: 2, assistant_conversations: 1 });
    expect(ids('conversations')).toEqual(['c-live', 'c-recent']);
    expect(ids('assistant_conversations')).toEqual(['a-live']);
  });

  it('erases the purged conversations’ audit rows by request id ONLY (never user_id)', async () => {
    await purgeDeletedConversations(NOW);
    expect(erasedIds()).toEqual(['r-a-old', 'r-old', 'r-old2']);
    for (const [arg] of mocks.eraseAuditTrail.mock.calls) {
      expect(Object.keys(arg)).toEqual(['request_ids']);
    }
  });

  it('deletes the purged conversations’ search_history rows (question text), keeps the rest', async () => {
    await purgeDeletedConversations(NOW);
    expect(ids('search_history')).toEqual(['h-doc', 'h-live']);
  });

  it('skips a batch whose audit erasure fails — conversation and history stay, retried next run', async () => {
    mocks.eraseAuditTrail.mockRejectedValue(new Error('brain down'));
    const res = await purgeDeletedConversations(NOW);
    expect(res).toEqual({ conversations: 0, assistant_conversations: 0 });
    expect(ids('conversations')).toEqual(['c-live', 'c-old', 'c-old2', 'c-recent']);
    expect(ids('search_history')).toEqual(['h-doc', 'h-live', 'h-old', 'h-old2']);
    expect(ids('assistant_conversations')).toEqual(['a-live', 'a-old']);

    mocks.eraseAuditTrail.mockResolvedValue({ ok: true, requests_deleted: 1, feedback_deleted: 0 });
    expect(await purgeDeletedConversations(NOW)).toEqual({ conversations: 2, assistant_conversations: 1 });
  });

  it('works in bounded batches and moves past a failed batch to the next one', async () => {
    mocks.eraseAuditTrail.mockImplementation(async ({ request_ids }: { request_ids: string[] }) => {
      if (request_ids.includes('r-old')) throw new Error('blip');
      return { ok: true, requests_deleted: 1, feedback_deleted: 0 };
    });
    const res = await purgeDeletedConversations(NOW, { batchSize: 1 });
    expect(res).toEqual({ conversations: 1, assistant_conversations: 1 });
    expect(ids('conversations')).toEqual(['c-live', 'c-old', 'c-recent']);
    expect(ids('search_history')).toEqual(['h-doc', 'h-live', 'h-old']);
    // one erase call per batch, each with that batch's ids only
    expect(mocks.eraseAuditTrail.mock.calls.map(([a]) => a.request_ids)).toEqual([
      ['r-old'],
      ['r-old2'],
      ['r-a-old'],
    ]);
  });

  it('purges without calling the brain when the batch has no audited messages', async () => {
    fake.reset();
    fake.seed('conversations', [{ id: 'c-v1', user_id: 'u', deleted_at: ago(40) }]);
    fake.seed('messages', [{ id: 'm', conversation_id: 'c-v1', brain_request_id: null }]);
    expect(await purgeDeletedConversations(NOW)).toEqual({ conversations: 1, assistant_conversations: 0 });
    expect(mocks.eraseAuditTrail).not.toHaveBeenCalled();
  });

  it('keeps the conversation when its search_history cannot be deleted (no stranded question text)', async () => {
    fake.failOn('search_history', 'delete', { message: 'boom' });
    const res = await purgeDeletedConversations(NOW);
    expect(res.conversations).toBe(0);
    expect(ids('conversations')).toEqual(['c-live', 'c-old', 'c-old2', 'c-recent']);
  });

  it('is idempotent (a second run / another replica deletes nothing more)', async () => {
    await purgeDeletedConversations(NOW);
    vi.clearAllMocks();
    expect(await purgeDeletedConversations(NOW)).toEqual({ conversations: 0, assistant_conversations: 0 });
    expect(mocks.eraseAuditTrail).not.toHaveBeenCalled();
  });

  it('is a no-op when retention is disabled (0)', async () => {
    const prev = env.RETENTION_DELETED_CONVERSATION_DAYS;
    (env as { RETENTION_DELETED_CONVERSATION_DAYS: number }).RETENTION_DELETED_CONVERSATION_DAYS = 0;
    try {
      expect(await purgeDeletedConversations(NOW)).toEqual({});
      expect(fake.rows('conversations')).toHaveLength(4);
      expect(mocks.eraseAuditTrail).not.toHaveBeenCalled();
    } finally {
      (env as { RETENTION_DELETED_CONVERSATION_DAYS: number }).RETENTION_DELETED_CONVERSATION_DAYS = prev;
    }
  });
});
