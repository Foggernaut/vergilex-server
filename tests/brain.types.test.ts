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
