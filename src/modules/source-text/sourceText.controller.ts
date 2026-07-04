import type { RequestHandler } from 'express';
import { z } from 'zod';
import { brainClient } from '../../brain/brain.client.js';
import { AuthError } from '../../utils/errors.js';

const querySchema = z.object({
  source_type: z.string().min(2).max(30),
  chunk_id: z.string().min(1).max(300),
  parent_id: z.string().max(300).optional(),
});

// ── Tiny in-memory cache (cost control) ──────────────────────────────────────
// Corpus text is static between ingestions; full texts are large, so cap the
// entry count instead of relying on TTL alone.
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const cache = new Map<string, { at: number; data: unknown }>();

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.at > TTL_MS) cache.delete(k);
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// GET /api/tam-metin?source_type=&chunk_id=&parent_id=
// Free (no LLM cost) but auth-gated — same posture as catalog/favorites.
export const getSourceFullText: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const params = querySchema.parse(req.query);

    const key = `${params.source_type}|${params.chunk_id}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      res.json(hit.data);
      return;
    }

    const result = await brainClient.getDocumentFullText(params);
    cache.set(key, { at: Date.now(), data: result });
    pruneCache();
    res.json(result);
  } catch (err) {
    next(err);
  }
};
