// Per-request data-subject context (KVKK md.11 silme hakkı).
//
// The brain tags every audit row it writes with an HMAC of the user id it
// receives in `X-Subject-Id`, so account deletion can erase ALL of a user's
// audit rows — not only those still linked from surviving messages. The header
// is added centrally by the brain client from this AsyncLocalStorage store, so
// no call site has to thread the user id through.
//
// The store is established by `requireAuth` (and by the ticket-authenticated
// EventSource route, which runs before requireAuth). Async continuations — awaits,
// async generators consumed in the handler, fire-and-forget promises — inherit it.
// Code outside any request (scheduled jobs) has no store → no header.
//
// multer (>=2.x) binds its next() to the caller's async scope itself, so multipart
// routes keep the store too (covered by tests/brain-subject-header.test.ts).
import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContext {
  subjectId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` (and everything it schedules) on behalf of the given user. */
export function runWithSubject<T>(subjectId: string, fn: () => T): T {
  return als.run({ subjectId }, fn);
}

/** Runs `fn` with NO subject, even when called from inside a request (system work). */
export function runWithoutSubject<T>(fn: () => T): T {
  return als.exit(fn);
}

export function currentSubjectId(): string | undefined {
  return als.getStore()?.subjectId;
}

