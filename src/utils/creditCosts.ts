import type { AnswerLength } from '../brain/brain.types.js';

export const CREDIT_COSTS = {
  chat: { short: 2, medium: 5, long: 8 },
  follow_up: { short: 1, medium: 3, long: 5 },
  doc_finder: 2,
  // V2 demo: flat 5 KR/soru (both new conversation and follow-up).
  v2_chat: 5,
  // Mevzuat Asistanı (Opus 4.8, 3-layer): Sonnet triage + Opus gather loop +
  // 5–7 parallel Opus per-corpus summaries + a streamed Opus essay + güvence.
  // Many Opus calls per request → priced well above v1/v2.
  assistant: { short: 20, medium: 20, long: 20 },
  assistant_follow_up: { short: 15, medium: 25, long: 40 },
} as const;

export const DEFAULT_ANSWER_LENGTH: AnswerLength = 'long';

export function chatCost(length: AnswerLength): number {
  return CREDIT_COSTS.chat[length];
}

export function followUpCost(length: AnswerLength): number {
  return CREDIT_COSTS.follow_up[length];
}

export function v2ChatCost(): number {
  return CREDIT_COSTS.v2_chat;
}

export function assistantChatCost(length: AnswerLength): number {
  return CREDIT_COSTS.assistant[length];
}

export function assistantFollowUpCost(length: AnswerLength): number {
  return CREDIT_COSTS.assistant_follow_up[length];
}

export type { AnswerLength };
