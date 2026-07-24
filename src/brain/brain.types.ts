import { z } from 'zod';

// Mirrors mevzuat-knowledge-api v2 Pydantic models.

// Known source types the brain can emit. Kept for typed downstream use, but
// the schema below intentionally does NOT gate parsing on this list: the brain
// adds new corpora over time (e.g. ansiklopedi/makale/bdk/danistay_karar), and
// a strict z.enum would reject the WHOLE response the moment a new value lands.
export const KNOWN_SOURCE_TYPES = [
  'chunk',
  'table',
  'footnote',
  'ozelge',
  'soru_cevap',
  'ansiklopedi',
  'makale',
  'doktrin',
  'bdk',
  'danistay_karar',
  'gib_kaynak',
] as const;
export type BrainSourceType = (typeof KNOWN_SOURCE_TYPES)[number];

export const BrainDocumentResultSchema = z.object({
  chunk_id: z.string(),
  law_id: z.string(),
  law_name: z.string(),
  madde_no: z.string().nullable(),
  madde_basligi: z.string().nullable(),
  // Pre-formatted UI header from the brain (picks the right format per
  // source_type). Optional/nullable so older brain responses still parse.
  title: z.string().nullable().optional(),
  // Metadata/provenance line (daire · tarih, yazar · dönem, …). Optional/nullable
  // so older brain responses (pre-subtitle) still parse.
  subtitle: z.string().nullable().optional(),
  excerpt: z.string(),
  relevance_score: z.number(),
  // Permissive on purpose — see KNOWN_SOURCE_TYPES above.
  source_type: z.string(),
  // Parent-document id (karar_id / ozelge_id / makale_id / article_id) for the
  // full-text lookup. Optional/nullable: older brain responses don't carry it,
  // and without this key zod would silently strip it before persistence.
  source_id: z.string().nullable().optional(),
  law_references: z.array(z.string()),
  // Kaynağın orijinal dili ('en'/'tr'; şimdilik yalnız iham_karar doldurur).
  // Anahtar şemada olmazsa zod alanı sessizce eler — UI dil rozeti kaybolur.
  dil: z.string().nullable().optional(),
  // Alaka triyajı (brain GNDO §4.4) — "dogrudan" | "cevresel". Anahtar şemada
  // olmazsa zod alanı sessizce eler ve JSONB persist'e hiç yazılmaz — ÇEVRESEL
  // rozeti kalıcı mesajlarda kaybolur. Gerekçe UI tooltip'inde gösterilir.
  relevance_category: z.string().nullable().optional(),
  relevance_rationale: z.string().nullable().optional(),
  // Künye doğrulama alanları (brain DocumentResult "VERIFICATION" bloğu):
  // source_ref = insan-okur künye ("Danıştay 9.D. E:2022/4647 K:2023/459 (2023)"),
  // source_url = resmî kaynak linki, dogrulanmali = zayıf-künye bayrağı (UI rozet).
  // Anahtar şemada olmazsa zod sessizce eler → persist edilen her mesaj künyeyi
  // KALICI olarak kaybeder (relevance_category ile aynı tuzak). `full_text`
  // BİLEREK dışarıda: kaynak başına tam metin payload/JSONB maliyetini şişirir;
  // tam metni /v2/document endpoint'i talep üzerine verir.
  source_ref: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  dogrulanmali: z.boolean().nullable().optional(),
});
export type BrainDocumentResult = z.infer<typeof BrainDocumentResultSchema>;

export const BrainCostSchema = z.object({
  query_expansion_usd: z.number(),
  answer_generation_usd: z.number(),
  conflict_explanation_usd: z.number().default(0),
  total_usd: z.number(),
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
});
export type BrainCost = z.infer<typeof BrainCostSchema>;

const EMPTY_COST: BrainCost = {
  query_expansion_usd: 0,
  answer_generation_usd: 0,
  conflict_explanation_usd: 0,
  total_usd: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
};

export const AnswerLengthSchema = z.enum(['short', 'medium', 'long']);
export type AnswerLength = z.infer<typeof AnswerLengthSchema>;

export const BrainFiltersSchema = z
  .object({
    law_id: z.string().nullable().optional(),
    // 3-layer assistant corpus selection (corpus keys). Omitted/null = all corpora.
    corpora: z.array(z.string()).nullable().optional(),
  })
  .optional();

export const BrainFindDocumentsRequestSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: BrainFiltersSchema,
  limit: z.number().int().min(1).max(50).optional().default(20),
});
export type BrainFindDocumentsRequest = z.infer<typeof BrainFindDocumentsRequestSchema>;

export const BrainFindDocumentsResponseSchema = z.object({
  documents: z.array(BrainDocumentResultSchema),
  expanded_queries: z.array(z.string()),
  total_found: z.number().int(),
  search_time_ms: z.number().int(),
  secondary_legislation_note: z.string().nullable(),
  cost: BrainCostSchema.default(EMPTY_COST),
});
export type BrainFindDocumentsResponse = z.infer<typeof BrainFindDocumentsResponseSchema>;

// --- Belge Bul advanced search (POST /browse-documents) ---
// Deep per-corpus recall, parent-deduped. Optional layers: C) LLM query parse,
// B) facet filters, A) hybrid + cross-encoder rerank. Echoes `applied` (the
// effective intent) so the UI can show "understood as …" and let users edit it.
export const BrainBrowseFiltersSchema = z.object({
  corpora: z.array(z.string()).nullable().optional(),
  law_id: z.string().nullable().optional(),
  madde_no: z.string().nullable().optional(),
  daire: z.string().nullable().optional(),
  date_from: z.string().nullable().optional(),
  date_to: z.string().nullable().optional(),
  madde_tipi: z.string().nullable().optional(),
  exclude_mulga: z.boolean().optional(),
});
export type BrainBrowseFilters = z.infer<typeof BrainBrowseFiltersSchema>;

export const BrainBrowseDocumentsRequestSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: BrainBrowseFiltersSchema.optional(),
  // Candidate chunks pulled per corpus BEFORE parent-dedupe (1..200).
  per_corpus: z.number().int().min(1).max(200).optional(),
  smart: z.boolean().optional(),   // C: LLM query parse
  rerank: z.boolean().optional(),  // A: cross-encoder rerank
});
export type BrainBrowseDocumentsRequest = z.infer<typeof BrainBrowseDocumentsRequestSchema>;

// Effective intent echoed back (parsed + user-overridden filters).
export const BrainBrowseAppliedSchema = z.object({
  smart: z.boolean(),
  reranked: z.boolean(),
  semantic_query: z.string(),
  keywords: z.array(z.string()).default([]),
  corpora: z.array(z.string()).nullable().optional(),
  law_id: z.string().nullable().optional(),
  madde_no: z.string().nullable().optional(),
  daire: z.string().nullable().optional(),
  date_from: z.string().nullable().optional(),
  date_to: z.string().nullable().optional(),
  madde_tipi: z.string().nullable().optional(),
  exclude_mulga: z.boolean().default(true),
});
export type BrainBrowseApplied = z.infer<typeof BrainBrowseAppliedSchema>;

export const BrainBrowseDocumentsResponseSchema = z.object({
  documents: z.array(BrainDocumentResultSchema),
  total_found: z.number().int(),
  per_corpus_counts: z.record(z.string(), z.number().int()).default({}),
  search_time_ms: z.number().int(),
  applied: BrainBrowseAppliedSchema,
  cost: BrainCostSchema.default(EMPTY_COST),
});
export type BrainBrowseDocumentsResponse = z.infer<typeof BrainBrowseDocumentsResponseSchema>;

export const BrainHistoryItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type BrainHistoryItem = z.infer<typeof BrainHistoryItemSchema>;

export const BrainAnswerRequestSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: BrainFiltersSchema,
  history: z.array(BrainHistoryItemSchema).optional(),
  answer_length: AnswerLengthSchema.optional(),
});
export type BrainAnswerRequest = z.infer<typeof BrainAnswerRequestSchema>;

export const BrainConflictSchema = z.object({
  description: z.string(),
  chunk_ids: z.array(z.string()),
  // LLM-generated 1-2 sentence context-specific reasoning per conflict.
  // null when explainer was skipped (no conflicts) or failed gracefully.
  explanation: z.string().nullable().optional(),
});
export type BrainConflict = z.infer<typeof BrainConflictSchema>;

// Katman 2 — per-corpus generalization ("kanunlarda/Danıştay'da ne diyor").
export const BrainCorpusSummarySchema = z.object({
  corpus_type: z.string(),
  label: z.string(),
  summary: z.string(),
  chunk_count: z.number().int(),
  authority_level: z.number().int().default(0),
});
export type BrainCorpusSummary = z.infer<typeof BrainCorpusSummarySchema>;

export const BrainAnswerResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(BrainDocumentResultSchema),
  conflicts: z.array(BrainConflictSchema),
  // Katman 2 — optional/defaulted so v1/legacy responses still parse.
  corpus_summaries: z.array(BrainCorpusSummarySchema).default([]),
  confidence_score: z.number(),
  tokens_used: z.object({
    prompt: z.number().int(),
    completion: z.number().int(),
  }),
  not_found: z.boolean(),
  secondary_legislation_note: z.string().nullable(),
  cost: BrainCostSchema.default(EMPTY_COST),
  // B12.9: audited request id — echoed back so we can submit it to /v2/feedback.
  // null on the legacy v1 path (unaudited).
  request_id: z.string().nullable().optional(),
  // B12.6 composite trust signal — the discriminative answer-quality score
  // (fidelity/citations/source-tier weighted; CE is only 10%). This — not the
  // raw CE `confidence_score` — is what the client surfaces as the user-facing %.
  // Nullable/optional: legacy v1 path and older rows don't carry it.
  trust_band: z.string().nullable().optional(),
  trust_score: z.number().nullable().optional(),
  trust_explanation: z.string().nullable().optional(),
  // takip-tespit: true iff the brain classified THIS turn as a new topic (not a
  // continuation) and ignored prior history. We persist this as a context
  // boundary on the new user message so future turns load history only from
  // here onward. Optional/nullable: legacy v1 path doesn't carry it.
  context_reset: z.boolean().nullable().optional(),
  context_mode: z.string().nullable().optional(), // followup | new_context
});
export type BrainAnswerResponse = z.infer<typeof BrainAnswerResponseSchema>;

// --- v2 streaming (SSE) ---
// Parsed events from POST /v2/answer-questions/stream. `phase` is the masked
// coarse pipeline phase; `answer_delta` are LIVE pre-gate synthesis tokens (draft
// text the client holds citations on until validation); `complete` carries the
// authoritative, VALIDATED full response we persist and reveal as final.
export type BrainStreamEvent =
  | { type: 'phase'; phase: string }
  | { type: 'answer_delta'; text: string }
  // 3-layer assistant: Katman 1 docs / Katman 2 per-corpus summary / Katman 3 essay deltas.
  | { type: 'layer1'; documents: BrainDocumentResult[] }
  | { type: 'layer2'; corpus: string; label: string; summary: string }
  | { type: 'layer3_delta'; text: string }
  | { type: 'complete'; response: BrainAnswerResponse }
  | { type: 'error'; code: string; message: string };

// --- v2 document full text (kaynak modali "Tam metni görüntüle") ---

export const BrainFullTextResponseSchema = z.object({
  source_type: z.string(),
  parent_id: z.string().nullable().optional(),
  full_text: z.string(),
  char_count: z.number().int().optional(),
  // İHAM: EN kararın TR özet kardeşi + kaynak dili — modal sekmeleri için.
  ozet_tr: z.string().nullable().optional(),
  dil: z.string().nullable().optional(),
});
export type BrainFullTextResponse = z.infer<typeof BrainFullTextResponseSchema>;

// --- v2 feedback (👍/👎) ---

export const BrainFeedbackRequestSchema = z.object({
  request_id: z.string().min(1).max(64),
  rating: z.number().int().min(1).max(5),
  note: z.string().max(1000).optional(),
  user_id: z.string().max(64).optional(),
});
export type BrainFeedbackRequest = z.infer<typeof BrainFeedbackRequestSchema>;

export const BrainFeedbackResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable().optional(),
});
export type BrainFeedbackResponse = z.infer<typeof BrainFeedbackResponseSchema>;

// --- v2 analyze-document ---

export const BrainAnalyzeChunkPreviewSchema = z.object({
  text_preview: z.string(),
  page_or_section: z.string().nullable(),
  keywords: z.array(z.string()),
});
export type BrainAnalyzeChunkPreview = z.infer<typeof BrainAnalyzeChunkPreviewSchema>;

export const BrainAnalyzeDocumentResponseSchema = z.object({
  total_pages: z.number().int(),
  total_chars: z.number().int(),
  chunk_count: z.number().int(),
  detected_concepts: z.array(z.string()),
  chunks_preview: z.array(BrainAnalyzeChunkPreviewSchema),
  file_too_large: z.boolean(),
  error: z.string().nullable(),
});
export type BrainAnalyzeDocumentResponse = z.infer<typeof BrainAnalyzeDocumentResponseSchema>;
