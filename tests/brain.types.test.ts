import { describe, it, expect } from 'vitest';
import {
  BrainDocumentResultSchema,
  BrainFindDocumentsResponseSchema,
  BrainAnswerResponseSchema,
  KNOWN_SOURCE_TYPES,
} from '../src/brain/brain.types.js';

// The brain expanded source_type from 5 → 9 values and added a `title` field.
// These tests pin the permissive contract so a new corpus type can never again
// cause a BrainSchemaError that discards the whole response.

const baseDoc = {
  chunk_id: 'c1',
  law_id: 'gvk',
  law_name: 'Gelir Vergisi Kanunu',
  madde_no: '14',
  madde_basligi: 'Muafiyetler',
  title: 'Danıştay E:2020/1 K:2021/2 — 2021-03-04',
  excerpt: 'örnek metin',
  relevance_score: 0.91,
  source_type: 'danistay_karar',
  law_references: ['GVK m.14'],
};

describe('BrainDocumentResultSchema', () => {
  it('accepts the new title field and new source_type values', () => {
    const parsed = BrainDocumentResultSchema.safeParse(baseDoc);
    expect(parsed.success).toBe(true);
  });

  it('accepts every known source_type', () => {
    for (const st of KNOWN_SOURCE_TYPES) {
      const parsed = BrainDocumentResultSchema.safeParse({ ...baseDoc, source_type: st });
      expect(parsed.success, `source_type=${st}`).toBe(true);
    }
  });

  it('accepts an unknown future source_type without failing', () => {
    const parsed = BrainDocumentResultSchema.safeParse({ ...baseDoc, source_type: 'some_future_corpus' });
    expect(parsed.success).toBe(true);
  });

  it('still parses legacy responses that omit title', () => {
    const { title, ...legacy } = baseDoc;
    void title;
    const parsed = BrainDocumentResultSchema.safeParse({ ...legacy, source_type: 'chunk' });
    expect(parsed.success).toBe(true);
  });

  // Alaka triyajı: alanlar şemada OLMALI — zod bilinmeyen anahtarı sessizce
  // eler ve rozet kalıcı mesajlarda kaybolurdu. Retention'ı pinliyoruz.
  it('retains relevance_category/relevance_rationale through parse', () => {
    const parsed = BrainDocumentResultSchema.parse({
      ...baseDoc,
      relevance_category: 'cevresel',
      relevance_rationale: 'kıyasen değerli — sermaye tamamlama fonu analojisi',
    });
    expect(parsed.relevance_category).toBe('cevresel');
    expect(parsed.relevance_rationale).toContain('kıyasen');
  });

  it('parses triage-less legacy sources (fields optional)', () => {
    const parsed = BrainDocumentResultSchema.parse(baseDoc);
    expect(parsed.relevance_category).toBeUndefined();
  });

  // FastAPI, None'ı açık `null` olarak serileştirir — triyaj kapalı/etiketsiz
  // kaynakların GERÇEK wire şekli budur. `.nullable()` yanlışlıkla düşürülürse
  // prod payload'ları reddedilir; bu test onu pinler.
  it('accepts explicit nulls for triage fields (FastAPI wire shape)', () => {
    const parsed = BrainDocumentResultSchema.parse({
      ...baseDoc,
      relevance_category: null,
      relevance_rationale: null,
    });
    expect(parsed.relevance_category).toBeNull();
  });

  // Künye doğrulama alanları: retention (strip edilirse persist edilen mesajlar
  // künyeyi kalıcı kaybeder) + legacy omission + explicit null.
  it('retains source_ref/source_url/dogrulanmali through parse', () => {
    const parsed = BrainDocumentResultSchema.parse({
      ...baseDoc,
      source_ref: 'Danıştay 9.D. E:2022/4647 K:2023/459 (2023)',
      source_url: 'https://ornek.resmi.kaynak/karar/459',
      dogrulanmali: true,
    });
    expect(parsed.source_ref).toContain('E:2022/4647');
    expect(parsed.source_url).toContain('https://');
    expect(parsed.dogrulanmali).toBe(true);
  });

  it('parses sources without künye fields (legacy) and with explicit nulls', () => {
    expect(BrainDocumentResultSchema.safeParse(baseDoc).success).toBe(true);
    const parsed = BrainDocumentResultSchema.parse({
      ...baseDoc,
      source_ref: null,
      source_url: null,
      dogrulanmali: null,
    });
    expect(parsed.source_ref).toBeNull();
    expect(parsed.dogrulanmali).toBeNull();
  });
});

describe('response schemas carry new source types', () => {
  it('find-documents response with a danistay_karar doc parses', () => {
    const parsed = BrainFindDocumentsResponseSchema.safeParse({
      documents: [baseDoc],
      expanded_queries: ['q'],
      total_found: 1,
      search_time_ms: 12,
      secondary_legislation_note: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('answer-questions response with an ansiklopedi source parses', () => {
    const parsed = BrainAnswerResponseSchema.safeParse({
      answer: 'cevap',
      sources: [{ ...baseDoc, source_type: 'ansiklopedi', title: 'Mali Ansiklopedi' }],
      conflicts: [],
      confidence_score: 0.8,
      tokens_used: { prompt: 10, completion: 5 },
      not_found: false,
      secondary_legislation_note: null,
    });
    expect(parsed.success).toBe(true);
  });
});

// --- Answer signals (trust / position / degradation / clarifying) ------------
// These ride on the SAME response as the answer text and are what the client
// renders as the answer's vitals. Two failure modes are pinned here: a missing
// field must not make the whole response unparseable (legacy v1 has none of
// them), and a present field must not be silently stripped — zod drops unknown
// keys, which is exactly how the position/degradation signals went unused before.
describe('BrainAnswerResponseSchema — answer signals', () => {
  const baseAnswer = {
    answer: 'cevap',
    sources: [baseDoc],
    conflicts: [],
    confidence_score: 0.8,
    tokens_used: { prompt: 10, completion: 5 },
    not_found: false,
    secondary_legislation_note: null,
  };

  it('retains position / degradation / clarifying fields through parse', () => {
    const parsed = BrainAnswerResponseSchema.parse({
      ...baseAnswer,
      trust_band: 'MEDIUM',
      trust_score: 0.61,
      trust_explanation: 'dayanak orta',
      position_level: 'savunulabilir',
      position_score: 0.55,
      position_rationale: 'daire kararı var, VDDK yok',
      degraded: true,
      degradation_reason: 'unfaithful_citation',
      degradation_note: 'Doğrulanamayan ifadeler çıkarıldı.',
      clarifying_questions: ['Şirket tam mükellef mi?'],
    });
    expect(parsed.position_level).toBe('savunulabilir');
    expect(parsed.position_score).toBe(0.55);
    expect(parsed.position_rationale).toContain('VDDK');
    expect(parsed.degraded).toBe(true);
    expect(parsed.degradation_reason).toBe('unfaithful_citation');
    expect(parsed.degradation_note).toContain('çıkarıldı');
    expect(parsed.clarifying_questions).toEqual(['Şirket tam mükellef mi?']);
  });

  it('defaults clarifying_questions to [] when the brain omits it', () => {
    const parsed = BrainAnswerResponseSchema.parse(baseAnswer);
    expect(parsed.clarifying_questions).toEqual([]);
  });

  it('parses a legacy v1 response carrying no signals at all', () => {
    const parsed = BrainAnswerResponseSchema.safeParse(baseAnswer);
    expect(parsed.success).toBe(true);
  });

  it('accepts explicit nulls for every signal (FastAPI wire shape)', () => {
    const parsed = BrainAnswerResponseSchema.parse({
      ...baseAnswer,
      trust_band: null,
      trust_score: null,
      trust_explanation: null,
      position_level: null,
      position_score: null,
      position_rationale: null,
      degraded: null,
      degradation_reason: null,
      degradation_note: null,
    });
    expect(parsed.position_level).toBeNull();
    expect(parsed.degraded).toBeNull();
  });

  // position_level is a bare string on purpose: the brain owns that vocabulary
  // (services/position_strength.py). A new grade there must not make the whole
  // answer fail to parse — same permissive contract as source_type.
  it('accepts an unknown future position_level', () => {
    const parsed = BrainAnswerResponseSchema.safeParse({
      ...baseAnswer,
      position_level: 'çok agresif',
    });
    expect(parsed.success).toBe(true);
  });
});
