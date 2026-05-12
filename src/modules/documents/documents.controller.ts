import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AuthError } from '../../utils/errors.js';
import { brainClient } from '../../brain/brain.client.js';
import { deductCredits } from '../credits/credits.service.js';
import { CREDIT_COSTS } from '../../utils/creditCosts.js';
import { supabaseAdmin } from '../../config/supabase.js';

const docFinderSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: z.object({ law_id: z.string().nullable().optional() }).optional(),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

export const findDocuments: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = docFinderSchema.parse(req.body);

    const result = await brainClient.findDocuments(input);

    const { newBalance } = await deductCredits({
      userId: req.user.id,
      amount: CREDIT_COSTS.doc_finder,
      type: 'doc_finder',
      description: input.query.slice(0, 200),
      metadata: { results_count: result.documents.length },
    });

    await supabaseAdmin.from('search_history').insert({
      user_id: req.user.id,
      query: input.query,
      search_type: 'doc_finder',
      filters: input.filters ?? null,
      results_count: result.documents.length,
    });

    res.json({ ...result, newBalance });
  } catch (err) {
    next(err);
  }
};
