import { logger } from '../config/logger.js';
import type { BrainAnswerResponse } from '../brain/brain.types.js';

/**
 * Per-answer QUALITY SIGNALS the brain returns alongside the answer text, shared
 * by both chat surfaces (Mevzuat Sohbet + Mevzuat Asistanı).
 *
 * Three separate axes, none of them a restatement of another:
 *   trust_*     — how well grounded the answer is in its sources (B12.6 composite)
 *   position_*  — how defensible the position is against the idare / yargı
 *   degraded/…  — a blocking güvence gate stripped unverifiable sentences instead
 *                 of dropping the whole answer
 * plus `clarifying_questions`, the machine-readable form of the answer's EKSİK
 * BİLGİ section.
 *
 * Persisted by migration 016_answer_signals.sql. Everything here degrades
 * gracefully when that migration has NOT been applied to the running database
 * yet: the write retries without the signal columns and the read falls back to
 * the base column list, so deploying this code ahead of the migration can never
 * cost a user a billed answer. The live turn is unaffected either way, because
 * the values are merged into the returned message from the brain response in
 * memory (see `answerSignalFields`).
 */
export const ANSWER_SIGNAL_COLUMNS = [
  'trust_band',
  'trust_score',
  'trust_explanation',
  'position_level',
  'position_score',
  'position_rationale',
  'degraded',
  'degradation_reason',
  'degradation_note',
  'clarifying_questions',
] as const;

/** Signal columns as a PostgREST select fragment (no leading comma). */
export const ANSWER_SIGNAL_SELECT = ANSWER_SIGNAL_COLUMNS.join(', ');

/** Append the signal columns to an existing select list. */
export function withSignalSelect(baseSelect: string): string {
  return `${baseSelect}, ${ANSWER_SIGNAL_SELECT}`;
}

/**
 * The signal values shaped for the client / for an in-memory merge onto a
 * persisted row. `degraded` is coerced to a boolean because the column is
 * NOT NULL DEFAULT FALSE, and `clarifying_questions` normalises to an array.
 */
export function answerSignalFields(answer: BrainAnswerResponse) {
  return {
    trust_band: answer.trust_band ?? null,
    trust_score: answer.trust_score ?? null,
    trust_explanation: answer.trust_explanation ?? null,
    position_level: answer.position_level ?? null,
    position_score: answer.position_score ?? null,
    position_rationale: answer.position_rationale ?? null,
    degraded: answer.degraded ?? false,
    degradation_reason: answer.degradation_reason ?? null,
    degradation_note: answer.degradation_note ?? null,
    clarifying_questions: answer.clarifying_questions ?? [],
  };
}

/**
 * The same values shaped for an INSERT. Differs from `answerSignalFields` in one
 * place: an empty `clarifying_questions` is stored as NULL rather than an empty
 * JSONB array, so "nothing to clarify" and "not recorded" read the same way in
 * the database as they do for every other nullable signal.
 */
export function answerSignalRow(answer: BrainAnswerResponse): Record<string, unknown> {
  const fields = answerSignalFields(answer);
  return {
    ...fields,
    clarifying_questions: fields.clarifying_questions.length ? fields.clarifying_questions : null,
  };
}

/**
 * True when PostgREST rejected the statement because a column it mentions does
 * not exist on the running database — i.e. migration 016 hasn't been applied
 * here yet. PGRST204 is PostgREST's own "column not found in schema cache";
 * 42703 is Postgres' undefined_column.
 */
export function isUnknownColumnError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST204' || code === '42703';
}

type QueryResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

/**
 * Supabase query builders are thenable but are NOT real Promises (no `catch` /
 * `finally`), so the callbacks below are typed as PromiseLike — otherwise a
 * builder returned straight from the callback fails to match and T silently
 * infers as `{}`.
 */
type QueryThunk<T, A> = (arg: A) => PromiseLike<QueryResult<T>>;

/**
 * Insert a message row WITH its answer signals, retrying without them if the
 * signal columns aren't there yet.
 *
 * The retry matters because a failed message insert is fatal to an
 * already-billed chat turn: the user is charged, the brain has done all its
 * work, and losing the row would lose the answer. Migration state must never be
 * able to cause that.
 */
export async function insertWithSignals<T>(
  args: {
    /** Only for the log line when the signal columns turn out to be missing. */
    table: string;
    row: Record<string, unknown>;
    answer: BrainAnswerResponse;
  },
  run: QueryThunk<T, Record<string, unknown>>
): Promise<QueryResult<T>> {
  const withSignals = { ...args.row, ...answerSignalRow(args.answer) };
  const first = await run(withSignals);
  if (!first.error || !isUnknownColumnError(first.error)) return first;

  logger.warn(
    'answer signal columns missing — inserting without them (apply migration 016_answer_signals.sql)',
    { table: args.table, code: first.error.code, message: first.error.message }
  );
  return run(args.row);
}

/**
 * Read rows with the signal columns appended to `baseSelect`, falling back to
 * `baseSelect` alone when those columns don't exist yet. A history reload must
 * still return the conversation even if the signals can't come with it.
 */
export async function selectWithSignals<T>(
  baseSelect: string,
  run: QueryThunk<T, string>
): Promise<QueryResult<T>> {
  const first = await run(withSignalSelect(baseSelect));
  if (!first.error || !isUnknownColumnError(first.error)) return first;

  logger.warn(
    'answer signal columns missing — reading without them (apply migration 016_answer_signals.sql)',
    { code: first.error.code, message: first.error.message }
  );
  return run(baseSelect);
}
