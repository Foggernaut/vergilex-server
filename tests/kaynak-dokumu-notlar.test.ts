import { describe, it, expect } from 'vitest';
import { BrainAnswerResponseSchema } from '../src/brain/brain.types.js';

// Faz 4a (2026-11-24): Kaynak Dökümü tablosu ve otomatik notlar cevap METNİNDEN yapısal alana —
// beyin `kaynak_dokumu` + `notlar` döner; server şemadan geçirip mesaja taşır (migration 025).
const baseAnswer = {
  answer: 'cevap',
  sources: [],
  conflicts: [],
  confidence_score: 0.8,
  tokens_used: { prompt: 10, completion: 5 },
  not_found: false,
  secondary_legislation_note: null,
};
const dokum = [
  { kategori: 'Olumlu kararlar', yon: 'olumlu', kaynaklar: [] },
  {
    kategori: 'Olumsuz kararlar',
    yon: 'olumsuz',
    kaynaklar: [{ kunye: 'Danıştay 4. D. E:2021/1699 K:2021/3911', kaynak_no: [12], ayrinti: 'hüküm: bozma' }],
  },
];
const notlar = [
  { tur: 'anılan karar', metin: 'E:2007/4866 külliyatta bulunamadı.', onem: 'kritik', kaynak_no: null },
  { tur: 'taranan kaynaklar', metin: 'kanun ✓1 · tebliğ ✓1', onem: 'bilgi' },
];

describe('kaynak_dokumu + notlar schema', () => {
  it('parses both fields', () => {
    const r = BrainAnswerResponseSchema.parse({ ...baseAnswer, kaynak_dokumu: dokum, notlar });
    expect(r.kaynak_dokumu).toHaveLength(2);
    expect(r.kaynak_dokumu?.[1]?.kaynaklar[0]?.kaynak_no).toEqual([12]);
    expect(r.kaynak_dokumu?.[0]?.yon).toBe('olumlu');
    expect(r.notlar?.[0]?.onem).toBe('kritik');
    expect(r.notlar?.[1]?.tur).toBe('taranan kaynaklar');
  });

  it('missing fields parse as absent (DOKUM_KIPI=metin / eski beyin)', () => {
    const r = BrainAnswerResponseSchema.parse(baseAnswer);
    expect(r.kaynak_dokumu ?? null).toBeNull();
    expect(r.notlar ?? null).toBeNull();
  });

  it('malformed fields become null, the answer survives', () => {
    const r = BrainAnswerResponseSchema.safeParse({ ...baseAnswer, kaynak_dokumu: 'x', notlar: [{ tur: 3 }] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.kaynak_dokumu).toBeNull();
    expect(r.success && r.data.notlar).toBeNull();
    expect(r.success && r.data.answer).toBe('cevap');
  });

  it('defaults optional row parts', () => {
    const r = BrainAnswerResponseSchema.parse({
      ...baseAnswer,
      kaynak_dokumu: [{ kategori: 'İki yönlü / karma', kaynaklar: [{ kunye: 'A' }] }],
      notlar: [{ tur: 'teyit', metin: 'm' }],
    });
    expect(r.kaynak_dokumu?.[0]).toEqual({
      kategori: 'İki yönlü / karma',
      yon: 'bilinmiyor',
      kaynaklar: [{ kunye: 'A', kaynak_no: [], ayrinti: '' }],
    });
    expect(r.notlar?.[0]?.onem).toBe('uyari');
  });
});

describe('chat optional columns', async () => {
  const { OPTIONAL_COLS, msgCols } = await import('../src/modules/chat/chat.service.js');
  it('carries the two new optional columns', () => {
    expect(OPTIONAL_COLS).toContain('kaynak_dokumu');
    expect(OPTIONAL_COLS).toContain('notlar');
    expect(msgCols(new Set<string>(OPTIONAL_COLS))).toContain('kaynak_dokumu, notlar');
    expect(msgCols(new Set<string>(['kaynak_envanteri']))).not.toContain('notlar');
  });
});
