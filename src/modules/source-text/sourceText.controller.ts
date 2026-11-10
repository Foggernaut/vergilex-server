import type { RequestHandler } from 'express';
import { z } from 'zod';
import { brainClient } from '../../brain/brain.client.js';
import { AuthError } from '../../utils/errors.js';
import { TextCache } from './textCache.js';

const querySchema = z.object({
  source_type: z.string().min(2).max(30),
  chunk_id: z.string().min(1).max(300),
  parent_id: z.string().max(300).optional(),
});

// ── Tiny in-memory cache (cost control) ──────────────────────────────────────
// Tam metinler büyük olabilir (bütün tebliğ ~1,4M karakter): kayıt sayısı + TTL'e ek olarak
// toplam karakter sınırı var (bkz. textCache.ts).
const cache = new TextCache({ ttlMs: 24 * 60 * 60 * 1000, maxEntries: 200, maxTotalChars: 8_000_000 });

// GET /api/tam-metin?source_type=&chunk_id=&parent_id=
// Free (no LLM cost) but auth-gated — same posture as catalog/favorites.
export const getSourceFullText: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const params = querySchema.parse(req.query);

    // parent_id anahtarda: aynı chunk farklı üst belgeyle farklı metin dönebilir.
    const key = `${params.source_type}|${params.chunk_id}|${params.parent_id ?? ''}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      res.json(hit);
      return;
    }

    const result = await brainClient.getDocumentFullText(params);
    cache.set(key, result, result.full_text.length);
    res.json(result);
  } catch (err) {
    next(err);
  }
};
