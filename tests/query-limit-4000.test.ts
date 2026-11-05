// Soru tavanı 1000 → 4000 karakter (2026-10-18): uzun somut olay soruları 0 ms'de 400 alıyordu.
import { describe, expect, it } from 'vitest';
import { MAX_QUERY_CHARS } from '../src/utils/queryLimits.js';
import { newAssistantChatSchema, assistantFollowUpSchema } from '../src/modules/assistant/assistant.schema.js';

describe('query length limit', () => {
  it('is 4000 and shared', () => {
    expect(MAX_QUERY_CHARS).toBe(4000);
  });
  it('accepts a 4000-char Turkish question and rejects 4001', () => {
    const q = 'ş'.repeat(4000);
    expect(newAssistantChatSchema.safeParse({ query: q }).success).toBe(true);
    expect(assistantFollowUpSchema.safeParse({ query: q }).success).toBe(true);
    expect(newAssistantChatSchema.safeParse({ query: q + 'x' }).success).toBe(false);
  });
});
