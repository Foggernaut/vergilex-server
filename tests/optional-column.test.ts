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
