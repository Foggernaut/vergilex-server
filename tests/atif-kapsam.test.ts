import { describe, it, expect } from 'vitest';
import { BrainAnswerResponseSchema } from '../src/brain/brain.types.js';
import { msgCols, optionalFields, OPTIONAL_COLS } from '../src/modules/assistant/assistant.service.js';

// Radar 2026-11-20: atıf kontrolü + kapsam notu — beyin yanıtından geçer, asistan mesajına opsiyonel kolon.
const baseAnswer = {
  answer: 'cevap',
  sources: [],
  conflicts: [],
  confidence_score: 0.8,
  tokens_used: { prompt: 10, completion: 5 },
  not_found: false,
  secondary_legislation_note: null,
};

const atif = [
  { atif: 'VUK md. 359', tur: 'madde', durum: 'dogrulandi', neden: 'Cevabın kaynakları arasında.' },
  { atif: 'E:2019/1 K:2020/2', tur: 'karar', durum: 'sorunlu', neden: 'Esas ve karar numaraları…' },
];
const kapsam = {
  kaynaklar: [
    { tur: 'ozelge', ad: 'özelge', durum: 'tarandi', sentez: 2, tarih: '2026-08-07', tarih_turu: 'belge', eski: false },
    { tur: 'sirkuler', ad: 'sirküler', durum: 'bulunamadi', sentez: 0, tarih: '2025-12-25', tarih_turu: 'belge', eski: true },
  ],
  uyarilar: ['Sirküler: külliyattaki en yeni belge 25.12.2025 tarihli; …'],
};

describe('atif_kontrolu + kapsam_notu schema', () => {
  it('parses both fields', () => {
    const r = BrainAnswerResponseSchema.parse({ ...baseAnswer, atif_kontrolu: atif, kapsam_notu: kapsam });
    expect(r.atif_kontrolu).toHaveLength(2);
    expect(r.atif_kontrolu?.[1]?.durum).toBe('sorunlu');
    expect(r.kapsam_notu?.kaynaklar[1]?.eski).toBe(true);
    expect(r.kapsam_notu?.uyarilar).toHaveLength(1);
  });

  it('missing fields parse as absent (legacy brain)', () => {
    const r = BrainAnswerResponseSchema.parse(baseAnswer);
    expect(r.atif_kontrolu ?? null).toBeNull();
    expect(r.kapsam_notu ?? null).toBeNull();
  });

  it('malformed fields become null, the answer survives', () => {
    const r = BrainAnswerResponseSchema.safeParse({ ...baseAnswer, atif_kontrolu: 'x', kapsam_notu: { kaynaklar: 3 } });
    expect(r.success).toBe(true);
    expect(r.success && r.data.atif_kontrolu).toBeNull();
    expect(r.success && r.data.kapsam_notu).toBeNull();
    expect(r.success && r.data.answer).toBe('cevap');
  });
});

describe('assistant optional columns', () => {
  const answer = BrainAnswerResponseSchema.parse({ ...baseAnswer, atif_kontrolu: atif, kapsam_notu: kapsam });

  it('selects and writes only the columns included in this attempt', () => {
    const all = new Set<string>(OPTIONAL_COLS);
    expect(msgCols(all)).toContain('kaynak_envanteri, atif_kontrolu, kapsam_notu');
    expect(Object.keys(optionalFields(answer, all)).sort()).toEqual(['atif_kontrolu', 'kapsam_notu', 'kaynak_envanteri', 'notlar']);

    const noAtif = new Set<string>(['kaynak_envanteri', 'kapsam_notu']);   // 021 kısmen eksik
    expect(msgCols(noAtif)).not.toContain('atif_kontrolu');
    expect(optionalFields(answer, noAtif)).toEqual({ kaynak_envanteri: null, kapsam_notu: kapsam });

    expect(msgCols(new Set())).not.toContain('kaynak_envanteri');
    expect(optionalFields(answer, new Set())).toEqual({});
  });
});
