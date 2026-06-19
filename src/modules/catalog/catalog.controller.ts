import type { RequestHandler } from 'express';
import { z } from 'zod';
import { mevzuatDb } from '../../config/mevzuatDb.js';
import { NotFoundError } from '../../utils/errors.js';
import {
  CATALOG_COLUMNS,
  CATEGORIES,
  CATEGORY_BY_KEY,
  type CatalogItem,
  type CategoryCount,
} from './catalog.types.js';

// De-dupe rows that are identical across the visible fields (some source
// tables — e.g. `laws` — hold repeated entries with distinct ids). Preserves
// the incoming order (already sorted by the query).
function dedupeItems(rows: CatalogItem[]): CatalogItem[] {
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  for (const r of rows) {
    const key = [r.title, r.subtitle, r.meta1, r.meta2]
      .map((v) => (v ?? '').trim().toLowerCase())
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ── Tiny in-memory caches (cost control) ─────────────────────────────────────
// The catalog is effectively static reference data, so we serve it from memory
// and rarely touch the DB. No external cache needed for this read-only feature.
const CATEGORIES_TTL_MS = 12 * 60 * 60 * 1000; // 12h — counts only change on ingestion
const LIST_TTL_MS = 5 * 60 * 1000; // 5m for individual list pages

let categoriesCache: { at: number; data: CategoryCount[] } | null = null;
const listCache = new Map<string, { at: number; data: unknown }>();

function pruneListCache() {
  if (listCache.size <= 200) return;
  const now = Date.now();
  for (const [k, v] of listCache) {
    if (now - v.at > LIST_TTL_MS) listCache.delete(k);
  }
}

// GET /api/sistem-belgeler/categories
// Reads ONLY the tiny `catalog_counts` materialized view (7 rows) — never a live
// count scan over the big corpus views.
export const getCategories: RequestHandler = async (_req, res, next) => {
  try {
    if (categoriesCache && Date.now() - categoriesCache.at < CATEGORIES_TTL_MS) {
      res.json({ categories: categoriesCache.data });
      return;
    }

    const { data, error } = await mevzuatDb
      .from('catalog_counts')
      .select('key, total');
    if (error) throw error;

    const totals = new Map<string, number>(
      (data ?? []).map((r) => [String(r.key), Number(r.total) || 0])
    );

    // For de-duped categories the precomputed count includes duplicate source
    // rows, so it would overstate the pill. Recompute from the deduped set
    // (these tables are tiny). Cached for 12h alongside the rest.
    await Promise.all(
      CATEGORIES.filter((c) => c.dedupe).map(async (c) => {
        const { data: rows, error: e } = await mevzuatDb
          .from(c.view)
          .select(CATALOG_COLUMNS);
        if (e) throw e;
        totals.set(c.key, dedupeItems((rows ?? []) as CatalogItem[]).length);
      })
    );

    // Preserve the registry's display order and labels; default missing to 0.
    const categories: CategoryCount[] = CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      total: totals.get(c.key) ?? 0,
    }));

    categoriesCache = { at: Date.now(), data: categories };
    res.json({ categories });
  } catch (err) {
    next(err);
  }
};

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

// GET /api/sistem-belgeler/:category?search=&page=&limit=
// Cheap pagination: fetch limit+1 rows to derive hasMore — no count=exact scan.
export const getCategory: RequestHandler = async (req, res, next) => {
  try {
    const category = CATEGORY_BY_KEY.get(req.params.category ?? '');
    if (!category) throw new NotFoundError('Kategori bulunamadı');

    const { search, page, limit } = listQuerySchema.parse(req.query);

    const cacheKey = `${category.key}|${page}|${limit}|${search ?? ''}`;
    const cached = listCache.get(cacheKey);
    if (cached && Date.now() - cached.at < LIST_TTL_MS) {
      res.json(cached.data);
      return;
    }

    const from = (page - 1) * limit;

    let items: CatalogItem[];
    let hasMore: boolean;

    if (category.dedupe) {
      // Small category with duplicate source rows: fetch the whole (filtered)
      // set, de-dupe, then paginate in memory. Safe only because these tables
      // are tiny (well under PostgREST's 1000-row cap).
      let q = mevzuatDb
        .from(category.view)
        .select(CATALOG_COLUMNS)
        .order(category.orderBy, { ascending: category.ascending, nullsFirst: false });
      if (search) q = q.ilike('search_text', `%${search}%`);

      const { data, error } = await q;
      if (error) throw error;

      const deduped = dedupeItems((data ?? []) as CatalogItem[]);
      items = deduped.slice(from, from + limit);
      hasMore = deduped.length > from + limit;
    } else {
      const to = from + limit; // inclusive range → limit+1 rows (the extra row probes hasMore)
      let q = mevzuatDb
        .from(category.view)
        .select(CATALOG_COLUMNS)
        .order(category.orderBy, { ascending: category.ascending, nullsFirst: false })
        .range(from, to);

      if (search) {
        // Search the short, title-level `search_text` column only — never scans bodies.
        q = q.ilike('search_text', `%${search}%`);
      }

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as CatalogItem[];
      hasMore = rows.length > limit;
      items = hasMore ? rows.slice(0, limit) : rows;
    }

    const payload = { category: category.key, label: category.label, page, limit, hasMore, items };
    listCache.set(cacheKey, { at: Date.now(), data: payload });
    pruneListCache();

    res.json(payload);
  } catch (err) {
    next(err);
  }
};
