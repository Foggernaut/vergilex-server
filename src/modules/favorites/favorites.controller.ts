import type { RequestHandler } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase.js';
import { AuthError, NotFoundError } from '../../utils/errors.js';

const cachedDataSchema = z
  .object({
    chunk_id: z.string(),
    law_id: z.string(),
    law_name: z.string(),
    madde_no: z.string(),
    madde_basligi: z.string().nullable(),
    title: z.string().nullable().optional(),
    excerpt: z.string(),
    relevance_score: z.number(),
    // Permissive — mirrors BrainDocumentResultSchema; brain adds new corpora
    // (ansiklopedi/makale/bdk/danistay_karar) and a strict enum would reject
    // favoriting any source carrying a new type.
    source_type: z.string(),
    law_references: z.array(z.string()),
  })
  .passthrough();

const createFavoriteSchema = z.object({
  cached_data: cachedDataSchema,
  notes: z.string().max(1000).optional(),
});

export const listFavorites: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { data, error } = await supabaseAdmin
      .from('favorites')
      .select('id, chunk_id, source_type, cached_data, notes, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ favorites: data ?? [] });
  } catch (err) {
    next(err);
  }
};

export const createFavorite: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = createFavoriteSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('favorites')
      .insert({
        user_id: req.user.id,
        chunk_id: input.cached_data.chunk_id,
        source_type: input.cached_data.source_type,
        cached_data: input.cached_data,
        notes: input.notes ?? null,
      })
      .select('id, chunk_id, source_type, cached_data, notes, created_at')
      .single();
    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: { code: 'ALREADY_FAVORITED', message: 'Zaten favorilerinizde' } });
        return;
      }
      throw error;
    }
    res.status(201).json({ favorite: data });
  } catch (err) {
    next(err);
  }
};

export const deleteFavorite: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { id } = req.params as { id: string };
    const { data, error } = await supabaseAdmin
      .from('favorites')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id')
      .single();
    if (error || !data) throw new NotFoundError('Favori bulunamadı');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
