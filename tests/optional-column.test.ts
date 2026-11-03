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
