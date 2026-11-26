import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BrainAnswerResponseSchema } from '../src/brain/brain.types.js';
import {
  msgCols,
  optionalFields,
  OPTIONAL_COLS,
  shapeMessage,
} from '../src/modules/assistant/assistant.service.js';

// Asistan notları (2026-11-26): beyin NOT_KIPI=yapisal iken bilgi/uyarı notlarını mütalaa metninden çıkarıp `notlar`
// alanında döner. Server alanı Asistan mesajında taşımalı ve saklamalı (migration 026) — yoksa notlar kaybolur.
const baseAnswer = {
  answer: 'mütalaa',
  sources: [],
  conflicts: [],
  confidence_score: 0.8,
  tokens_used: { prompt: 10, completion: 5 },
  not_found: false,
  secondary_legislation_note: null,
};
const notlar = [
  { tur: 'anılan karar', metin: 'E:2007/4866 külliyatta bulunamadı.', onem: 'kritik', kaynak_no: null },
  { tur: 'taranan kaynaklar', metin: 'kanun ✓1 · tebliğ ✓1', onem: 'bilgi' },
];

describe('Asistan notlar alanı', () => {
  it('OPTIONAL_COLS notlar içerir; msgCols kolon varken seçer', () => {
    expect(OPTIONAL_COLS).toContain('notlar');
    expect(msgCols(new Set(['notlar']))).toContain('notlar');
    expect(msgCols(new Set())).not.toContain('notlar');
  });

  it('optionalFields notlar yalnız kolon varken', () => {
    const a = BrainAnswerResponseSchema.parse({ ...baseAnswer, notlar });
    expect(optionalFields(a, new Set(['notlar']))).toMatchObject({ notlar });
    expect(optionalFields(a, new Set())).not.toHaveProperty('notlar');
  });

  it('shapeMessage canlı turda notlar taşır (kolon yokken de)', () => {
    const a = BrainAnswerResponseSchema.parse({ ...baseAnswer, notlar });
    expect(shapeMessage({ id: 'm1' }, a).notlar).toEqual(notlar);
    expect(shapeMessage({ id: 'm1' }, BrainAnswerResponseSchema.parse(baseAnswer)).notlar).toBeNull();
  });

  it('migration 026 assistant_messages.notlar ekler, GRANT yok', () => {
    const sql = readFileSync('supabase/migrations/026_assistant_notlar.sql', 'utf8');
    expect(sql).toMatch(/ALTER TABLE public\.assistant_messages\s+ADD COLUMN IF NOT EXISTS notlar JSONB/);
    const ifadeler = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(ifadeler).not.toMatch(/\bGRANT\b/i);
  });
});
