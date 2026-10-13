// Prod 2026-10-13: a user without enough credits opened 3 Aşamalı; EventSource can't
// read the stream's 402, so the web fell back to the buffered route, which called the
// brain FIRST (~9 min, ~$1 LLM spend) and only failed at deductCredits — the user saw
// nothing and the question vanished. The buffered routes must 402 before the brain call.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const brain = vi.hoisted(() => ({
  assistantAnswer: vi.fn(),
  answer: vi.fn(),
  answerV2: vi.fn(),
}));
const balance = vi.hoisted(() => ({ credits: 0 }));
const convRow = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

vi.mock('../src/brain/brain.client.js', () => ({ brainClient: brain }));

// Minimal supabaseAdmin: users.credits for getBalance, a conversation row for the
// follow-up lookups. Everything after the brain call is never reached in these tests.
vi.mock('../src/config/supabase.js', () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    for (const m of ['select', 'eq', 'is', 'order', 'limit', 'in', 'insert', 'update']) q[m] = vi.fn(self);
    q.single = vi.fn(async () =>
      table === 'users'
        ? { data: { credits: balance.credits }, error: null }
        : { data: convRow.value, error: convRow.value ? null : new Error('not found') }
    );
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return q;
  };
  return { supabaseAdmin: { from: vi.fn(chain), rpc: vi.fn() } };
});

import { assertCanAfford } from '../src/modules/credits/credits.service.js';
import { startAssistantChat, followUpAssistant } from '../src/modules/assistant/assistant.service.js';
import { startConversation } from '../src/modules/chat/chat.service.js';
import { InsufficientCreditsError } from '../src/utils/errors.js';

beforeEach(() => {
  vi.clearAllMocks();
  balance.credits = 0;
  convRow.value = { id: 'c1', user_id: 'u1', filters: null, engine: 'v1' };
});

describe('assertCanAfford', () => {
  it('throws 402 when balance < cost', async () => {
    balance.credits = 19;
    await expect(assertCanAfford('u1', 20)).rejects.toBeInstanceOf(InsufficientCreditsError);
  });
  it('passes when balance covers cost, and skips the lookup for free actions', async () => {
    balance.credits = 20;
    await expect(assertCanAfford('u1', 20)).resolves.toBeUndefined();
    await expect(assertCanAfford('u1', 0)).resolves.toBeUndefined();
  });
});

describe('buffered routes pre-check credits before calling the brain', () => {
  it('assistant start: 402 and no brain call', async () => {
    await expect(startAssistantChat({ userId: 'u1', query: 'q' })).rejects.toBeInstanceOf(
      InsufficientCreditsError
    );
    expect(brain.assistantAnswer).not.toHaveBeenCalled();
  });

  it('assistant follow-up: 402 and no brain call', async () => {
    await expect(
      followUpAssistant({ userId: 'u1', conversationId: 'c1', query: 'q' })
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(brain.assistantAnswer).not.toHaveBeenCalled();
  });

  it('chat start (v1 and v2): 402 and no brain call', async () => {
    await expect(startConversation({ userId: 'u1', query: 'q' })).rejects.toBeInstanceOf(
      InsufficientCreditsError
    );
    await expect(
      startConversation({ userId: 'u1', query: 'q', engine: 'v2' })
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(brain.answer).not.toHaveBeenCalled();
    expect(brain.answerV2).not.toHaveBeenCalled();
  });

  it('streaming path (precomputed answer) is not re-checked here', async () => {
    // The stream route pre-checks before opening SSE; persisting an already-streamed
    // answer must not 402 again on a balance that changed meanwhile — deductCredits
    // owns that case. We only assert the pre-check is skipped (no users lookup).
    const { supabaseAdmin } = await import('../src/config/supabase.js');
    await startAssistantChat({
      userId: 'u1',
      query: 'q',
      precomputedAnswer: { answer: 'a', sources: [] } as never,
    }).catch(() => undefined);
    expect(brain.assistantAnswer).not.toHaveBeenCalled();
    const tables = (supabaseAdmin.from as unknown as { mock: { calls: string[][] } }).mock.calls.map(
      (c) => c[0]
    );
    expect(tables).not.toContain('users');
  });
});
