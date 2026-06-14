import type { AnswerLength } from '../brain/brain.types.js';

export const CREDIT_COSTS = {
  chat: { short: 2, medium: 5, long: 8 },
  follow_up: { short: 1, medium: 3, long: 5 },
  doc_finder: 2,
} as const;

export const DEFAULT_ANSWER_LENGTH: AnswerLength = 'long';

export function chatCost(length: AnswerLength): number {
  return CREDIT_COSTS.chat[length];
}

export function followUpCost(length: AnswerLength): number {
  return CREDIT_COSTS.follow_up[length];
}

export type { AnswerLength };
