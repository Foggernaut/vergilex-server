export const CREDIT_COSTS = {
  chat: 5,
  follow_up: 3,
  doc_finder: 2,
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;
