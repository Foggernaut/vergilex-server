import { describe, it, expect, vi } from 'vitest';
import {
  answerSignalFields,
  answerSignalRow,
  insertWithSignals,
  isUnknownColumnError,
  selectWithSignals,
  withSignalSelect,
  ANSWER_SIGNAL_COLUMNS,
} from '../src/utils/answerSignals.js';
import type { BrainAnswerResponse } from '../src/brain/brain.types.js';

// Silence the "columns missing" warnings these tests deliberately provoke.
vi.mock('../src/config/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function answer(overrides: Partial<BrainAnswerResponse> = {}): BrainAnswerResponse {
  return {
    answer: 'cevap',
    sources: [],
    conflicts: [],
    corpus_summaries: [],
    confidence_score: 0.8,
    tokens_used: { prompt: 1, completion: 1 },
    not_found: false,
    secondary_legislation_note: null,
    cost: {
      embedding_usd: 0,
      rerank_usd: 0,
      llm_usd: 0,
      total_usd: 0,
    },
    clarifying_questions: [],
    ...overrides,
  } as BrainAnswerResponse;
}

describe('answerSignalFields / answerSignalRow', () => {
  it('coerces degraded to false and clarifying_questions to [] for the client', () => {
    const fields = answerSignalFields(answer());
    expect(fields.degraded).toBe(false);
    expect(fields.clarifying_questions).toEqual([]);
    expect(fields.trust_band).toBeNull();
    expect(fields.position_level).toBeNull();
  });

  it('passes every signal through unchanged when the brain sends them', () => {
    const fields = answerSignalFields(
      answer({
        trust_band: 'LOW',
        trust_score: 0.31,
        trust_explanation: 'dayanak zayıf',
        position_level: 'agresif',
        position_score: 0.4,
        position_rationale: 'yalnız özelge dayanağı',
        degraded: true,
        degradation_reason: 'unfaithful_citation',
        degradation_note: 'not',
        clarifying_questions: ['Tam mükellef mi?'],
      })
    );
    expect(fields).toMatchObject({
      trust_band: 'LOW',
      position_level: 'agresif',
      degraded: true,
      degradation_reason: 'unfaithful_citation',
      clarifying_questions: ['Tam mükellef mi?'],
    });
  });

  // The INSERT shape differs in exactly one place from the client shape: an empty
  // clarifying list is stored as NULL, so "nothing to clarify" reads like every
  // other absent signal in the database instead of as an empty JSONB array.
  it('stores an empty clarifying list as NULL but keeps a non-empty one', () => {
    expect(answerSignalRow(answer()).clarifying_questions).toBeNull();
    expect(
      answerSignalRow(answer({ clarifying_questions: ['Hangi dönem?'] })).clarifying_questions
    ).toEqual(['Hangi dönem?']);
  });

  it('never writes a NULL into the NOT NULL degraded column', () => {
    expect(answerSignalRow(answer()).degraded).toBe(false);
  });
});

describe('isUnknownColumnError', () => {
  it('recognises the PostgREST and Postgres unknown-column codes', () => {
    expect(isUnknownColumnError({ code: 'PGRST204' })).toBe(true);
    expect(isUnknownColumnError({ code: '42703' })).toBe(true);
  });

  it('does not treat other failures as a missing migration', () => {
    expect(isUnknownColumnError({ code: '23505' })).toBe(false);
    expect(isUnknownColumnError(null)).toBe(false);
    expect(isUnknownColumnError(new Error('network'))).toBe(false);
  });
});

describe('withSignalSelect', () => {
  it('appends every signal column to the base select list', () => {
    const select = withSignalSelect('id, role, content');
    expect(select.startsWith('id, role, content, ')).toBe(true);
    for (const col of ANSWER_SIGNAL_COLUMNS) {
      expect(select).toContain(col);
    }
  });
});

describe('insertWithSignals', () => {
  const baseRow = { conversation_id: 'c1', role: 'assistant', content: 'cevap' };

  it('writes the signal columns alongside the row when they exist', async () => {
    const run = vi.fn().mockResolvedValue({ data: { id: 'm1' }, error: null });
    const result = await insertWithSignals(
      { table: 'messages', row: baseRow, answer: answer({ trust_band: 'HIGH' }) },
      run
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({ ...baseRow, trust_band: 'HIGH', degraded: false });
    expect(result.data).toEqual({ id: 'm1' });
  });

  // The whole point of the retry: the user has ALREADY been billed and the brain
  // has already done its work by the time we get here, so an unapplied migration
  // must cost the signals, never the answer.
  it('retries without the signal columns when migration 016 is missing', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST204', message: 'no column' } })
      .mockResolvedValueOnce({ data: { id: 'm1' }, error: null });

    const result = await insertWithSignals(
      { table: 'messages', row: baseRow, answer: answer({ trust_band: 'HIGH' }) },
      run
    );

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toEqual(baseRow);
    expect(run.mock.calls[1][0]).not.toHaveProperty('trust_band');
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: 'm1' });
  });

  it('does not retry on an unrelated failure, so real errors still surface', async () => {
    const error = { code: '23503', message: 'fk violation' };
    const run = vi.fn().mockResolvedValue({ data: null, error });

    const result = await insertWithSignals({ table: 'messages', row: baseRow, answer: answer() }, run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.error).toBe(error);
  });
});

describe('selectWithSignals', () => {
  it('reads with the signal columns when they exist', async () => {
    const run = vi.fn().mockResolvedValue({ data: [{ id: 'm1' }], error: null });
    const result = await selectWithSignals('id, role', run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toContain('trust_band');
    expect(result.data).toEqual([{ id: 'm1' }]);
  });

  it('falls back to the base select so a history reload still returns messages', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'undefined column' } })
      .mockResolvedValueOnce({ data: [{ id: 'm1' }], error: null });

    const result = await selectWithSignals('id, role', run);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toBe('id, role');
    expect(result.data).toEqual([{ id: 'm1' }]);
  });

  it('does not retry on an unrelated failure', async () => {
    const error = { code: 'PGRST301', message: 'jwt expired' };
    const run = vi.fn().mockResolvedValue({ data: null, error });

    const result = await selectWithSignals('id, role', run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.error).toBe(error);
  });
});
