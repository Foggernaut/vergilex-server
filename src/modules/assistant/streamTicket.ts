// Single-use, short-lived tickets for the EventSource assistant stream.
//
// EventSource can't send an Authorization header or a body, so the stream used
// to carry the Supabase JWT *and the user's question* in the query string —
// both end up in Railway/edge/proxy access logs and browser history. Instead the
// client POSTs the request (Bearer auth, JSON body) to /stream-ticket, gets an
// opaque random ticket, and opens EventSource with only `?ticket=`.
//
// Single-use also blocks EventSource auto-reconnect from re-running the paid
// pipeline. Store is in-process: correct for a single Railway replica. If the
// server is ever scaled horizontally, move this to a shared store (Redis /
// a Supabase table) — a ticket issued on one replica won't exist on another.
import { randomBytes } from 'node:crypto';

export interface StreamTicketPayload {
  userId: string;
  query: string;
  filters?: { law_id?: string | null; corpora?: string[] };
  answer_length?: 'short' | 'medium' | 'long';
}

export const STREAM_TICKET_TTL_MS = 60_000;
const MAX_OUTSTANDING = 5_000;

const store = new Map<string, { payload: StreamTicketPayload; expiresAt: number }>();

function sweep(now: number): void {
  for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
}

export function issueStreamTicket(payload: StreamTicketPayload): string {
  const now = Date.now();
  sweep(now);
  if (store.size >= MAX_OUTSTANDING) {
    // Bounded memory under abuse: evict the oldest (Map preserves insertion order).
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  const ticket = randomBytes(32).toString('base64url');
  store.set(ticket, { payload, expiresAt: now + STREAM_TICKET_TTL_MS });
  return ticket;
}

/** Returns the payload exactly once; null if unknown, already used, or expired. */
export function consumeStreamTicket(ticket: string): StreamTicketPayload | null {
  const entry = store.get(ticket);
  if (!entry) return null;
  store.delete(ticket);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.payload;
}

export function _resetStreamTicketsForTest(): void {
  store.clear();
}
