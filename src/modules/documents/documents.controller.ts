import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AuthError } from '../../utils/errors.js';
import { brainClient } from '../../brain/brain.client.js';
import { deductCredits } from '../credits/credits.service.js';
import { CREDIT_COSTS } from '../../utils/creditCosts.js';
import { supabaseAdmin } from '../../config/supabase.js';

// Belge Bul = advanced search: LLM query-parse (smart) + facet filters + hybrid/rerank.
// Deep per-corpus recall, parent-deduped, paginated client-side.
const facetSchema = z
  .object({
    corpora: z.array(z.string()).nullable().optional(),
    law_id: z.string().nullable().optional(),
    madde_no: z.string().nullable().optional(),
    daire: z.string().nullable().optional(),
    date_from: z.string().nullable().optional(),
    date_to: z.string().nullable().optional(),
    madde_tipi: z.string().nullable().optional(),
    exclude_mulga: z.boolean().optional(),
  })
  .optional();

const docFinderSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: facetSchema,
  per_corpus: z.number().int().min(1).max(200).optional(),
  smart: z.boolean().optional(),
  rerank: z.boolean().optional(),
});

export const findDocuments: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = docFinderSchema.parse(req.body);

    const result = await brainClient.browseDocuments({
      query: input.query,
      filters: input.filters ?? undefined,
      per_corpus: input.per_corpus,
      smart: input.smart,
      rerank: input.rerank,
    });

    const { newBalance } = await deductCredits({
      userId: req.user.id,
      amount: CREDIT_COSTS.doc_finder,
      type: 'doc_finder',
      description: input.query.slice(0, 200),
      metadata: {
        results_count: result.documents.length,
        cost: result.cost,
      },
    });

    await supabaseAdmin.from('search_history').insert({
      user_id: req.user.id,
      query: input.query,
      search_type: 'doc_finder',
      filters: { applied: result.applied, per_corpus_counts: result.per_corpus_counts },
      results_count: result.documents.length,
    });

    res.json({ ...result, newBalance });
  } catch (err) {
    next(err);
  }
};

// Belge Bul Geçmiş — kullanıcının doc_finder aramaları, sayfalı (limit+1 → hasMore,
// katalog controller'ıyla aynı desen). Salt-okunur; kredi/aiLimiter yok. idx_history_user_created
// (user_id, created_at DESC) bu sorguya birebir uyar. "Son Aramalar" da bunu küçük limit ile çağırır.
const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const getDocumentHistory: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { page, limit } = historyQuerySchema.parse(req.query);
    const from = (page - 1) * limit;
    const to = from + limit; // inclusive → limit+1 satır (fazladan satır hasMore'u yoklar)

    const { data, error } = await supabaseAdmin
      .from('search_history')
      .select('id, query, filters, results_count, created_at')
      .eq('user_id', req.user.id)
      .eq('search_type', 'doc_finder')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    res.json({ page, limit, hasMore, items: hasMore ? rows.slice(0, limit) : rows });
  } catch (err) {
    next(err);
  }
};
