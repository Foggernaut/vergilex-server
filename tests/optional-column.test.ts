import { describe, it, expect } from 'vitest';
import { isMissingColumn, withOptionalColumn } from '../src/utils/optionalColumn.js';

// Araştırma protokolü Faz 5: `kaynak_envanteri` kolonu (migration 016) ürün DB'sine henüz
// uygulanmamışsa mesaj kaydı ve geçmiş yükleme KIRILMAMALI — alan olmadan tekrar denenir.

describe('isMissingColumn', () => {
  it('recognises PostgREST and Postgres unknown-column codes only', () => {
    expect(isMissingColumn({ code: 'PGRST204' })).toBe(true);
    expect(isMissingColumn({ code: '42703' })).toBe(true);
    expect(isMissingColumn({ code: '23505' })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
    expect(isMissingColumn(undefined)).toBe(false);
  });
});

describe('withOptionalColumn', () => {
  it('uses the column when it exists (single call)', async () => {
    const calls: boolean[] = [];
    const res = await withOptionalColumn('kaynak_envanteri', async (include) => {
      calls.push(include);
      return { data: { id: 'm1' }, error: null };
    }, 'test');
    expect(calls).toEqual([true]);
    expect(res.data).toEqual({ id: 'm1' });
  });

  it('retries once without the column when it is missing', async () => {
    const calls: boolean[] = [];
    const res = await withOptionalColumn('kaynak_envanteri', async (include) => {
      calls.push(include);
      return include
        ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'kaynak_envanteri' column" } }
        : { data: { id: 'm2' }, error: null };
    }, 'test');
    expect(calls).toEqual([true, false]);
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: 'm2' });
  });

  it('does not retry on other errors', async () => {
    const calls: boolean[] = [];
    const res = await withOptionalColumn('kaynak_envanteri', async (include) => {
      calls.push(include);
      return { data: null, error: { code: '23505', message: 'duplicate' } };
    }, 'test');
    expect(calls).toEqual([true]);
    expect(res.error?.code).toBe('23505');
  });
});

// Main'in sinyal kolonları (insertWithSignals) ile envanter kolonu (withOptionalColumn) İÇ İÇE: biri eksikse
// diğeri yazılmaya devam eder (iki migration bağımsız; 016/017 sinyaller, 018 envanter).
import { insertWithSignals } from '../src/utils/answerSignals.js';
import type { BrainAnswerResponse } from '../src/brain/brain.types.js';

describe('withOptionalColumn ∘ insertWithSignals', () => {
  const answer = { trust_band: 'HIGH', kaynak_envanteri: { turler: [], atlandi: false, celiski: false } } as unknown as BrainAnswerResponse;

  async function kos(eksik: Set<string>) {
    const yazilan: Record<string, unknown>[] = [];
    const res = await withOptionalColumn('kaynak_envanteri', (include) =>
      insertWithSignals(
        { table: 'messages', answer, row: { content: 'x', ...(include ? { kaynak_envanteri: answer.kaynak_envanteri } : {}) } },
        async (row) => {
          yazilan.push(row);
          const bad = Object.keys(row).find((k) => eksik.has(k));
          return bad ? { data: null, error: { code: 'PGRST204', message: bad } } : { data: { id: 'm' }, error: null };
        }
      ), 'test');
    return { res, son: yazilan[yazilan.length - 1]! };
  }

  it('envanter kolonu yok, sinyaller var → sinyaller yazılır, envanter düşer', async () => {
    const { res, son } = await kos(new Set(['kaynak_envanteri']));
    expect(res.error).toBeNull();
    expect(son.trust_band).toBe('HIGH');
    expect('kaynak_envanteri' in son).toBe(false);
  });

  it('sinyal kolonları yok, envanter var → envanter yazılır, sinyaller düşer', async () => {
    const { res, son } = await kos(new Set(['trust_band']));
    expect(res.error).toBeNull();
    expect(son.kaynak_envanteri).toBeTruthy();
    expect('trust_band' in son).toBe(false);
  });
});

// Takip önerileri (019) envanter (018) gibi ayrı isteğe bağlı sütun: biri eksikse yalnız o düşer —
// sinyaller (016/017) ve diğer sütun yazılmaya devam eder.
import { withOptionalColumns } from '../src/utils/optionalColumn.js';

describe('withOptionalColumns ∘ insertWithSignals', () => {
  const answer = {
    trust_band: 'HIGH',
    kaynak_envanteri: { turler: [], atlandi: false, celiski: false },
    suggested_followups: ['Örtülü sermaye oranı nasıl hesaplanır?'],
  } as unknown as BrainAnswerResponse;

  async function kos(eksik: Set<string>, hata = 'PGRST204') {
    const yazilan: Record<string, unknown>[] = [];
    const res = await withOptionalColumns(['kaynak_envanteri', 'suggested_followups'], (cols) =>
      insertWithSignals(
        {
          table: 'messages',
          answer,
          row: {
            content: 'x',
            ...(cols.has('kaynak_envanteri') ? { kaynak_envanteri: answer.kaynak_envanteri } : {}),
            ...(cols.has('suggested_followups') ? { suggested_followups: answer.suggested_followups } : {}),
          },
        },
        async (row) => {
          yazilan.push(row);
          const bad = Object.keys(row).find((k) => eksik.has(k));
          return bad ? { data: null, error: { code: hata, message: bad } } : { data: { id: 'm' }, error: null };
        }
      ), 'test');
    return { res, yazilan, son: yazilan[yazilan.length - 1]! };
  }

  it('all columns present → one write carrying everything', async () => {
    const { res, yazilan, son } = await kos(new Set());
    expect(res.error).toBeNull();
    expect(yazilan).toHaveLength(1);
    expect(son.trust_band).toBe('HIGH');
    expect(son.kaynak_envanteri).toBeTruthy();
    expect(son.suggested_followups).toEqual(answer.suggested_followups);
  });

  it('only suggested_followups missing → signals and envanter still written', async () => {
    const { res, son } = await kos(new Set(['suggested_followups']));
    expect(res.error).toBeNull();
    expect(son.trust_band).toBe('HIGH');
    expect(son.kaynak_envanteri).toBeTruthy();
    expect('suggested_followups' in son).toBe(false);
  });

  it('only kaynak_envanteri missing → suggestions still written', async () => {
    const { res, son } = await kos(new Set(['kaynak_envanteri']));
    expect(res.error).toBeNull();
    expect(son.trust_band).toBe('HIGH');
    expect(son.suggested_followups).toEqual(answer.suggested_followups);
    expect('kaynak_envanteri' in son).toBe(false);
  });

  it('both missing → signals still written', async () => {
    const { res, son } = await kos(new Set(['kaynak_envanteri', 'suggested_followups']));
    expect(res.error).toBeNull();
    expect(son.trust_band).toBe('HIGH');
    expect('kaynak_envanteri' in son).toBe(false);
    expect('suggested_followups' in son).toBe(false);
  });

  it('does not retry on other errors', async () => {
    const { res, yazilan } = await kos(new Set(['content']), '23505');
    expect(res.error?.code).toBe('23505');
    expect(yazilan).toHaveLength(1);
  });
});
