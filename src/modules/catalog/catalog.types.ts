// Single source of truth for the document catalog ("Sistemdeki Belgeler").
// Each category maps to a public `catalog_*` view in the mevzuat RAG DB
// (see mevzuat-knowledge-api/db/setup_catalog_views.sql). The views all share
// the same short-column shape, so one registry drives both endpoints — no
// per-category branching in the controller.

export interface CatalogCategory {
  /** stable key used in the URL and by the web client */
  key: string;
  /** public view name in the mevzuat DB */
  view: string;
  /** human label (Turkish) shown in the UI */
  label: string;
  /** column the list is ordered by */
  orderBy: string;
  /** ascending order? */
  ascending: boolean;
  /**
   * Small categories whose underlying table has duplicate rows (e.g. `laws`
   * has repeated entries with distinct ids). When true, the controller fetches
   * the whole (filtered) category, de-dupes in memory, then paginates. Only use
   * for small tables (< ~1000 rows) — never for özelge/makale/danıştay.
   */
  dedupe?: boolean;
}

// Order here = display order in the UI.
export const CATEGORIES: readonly CatalogCategory[] = [
  { key: 'kanunlar',         view: 'catalog_kanunlar',         label: 'Kanunlar',                    orderBy: 'title', ascending: true, dedupe: true },
  { key: 'ozelgeler',        view: 'catalog_ozelgeler',        label: 'Özelgeler',                   orderBy: 'title', ascending: true },
  { key: 'makaleler',        view: 'catalog_makaleler',        label: 'Makaleler',                   orderBy: 'title', ascending: true },
  { key: 'doktrin',          view: 'catalog_doktrin',          label: 'Doktrin',                     orderBy: 'title', ascending: true },
  { key: 'danistay',         view: 'catalog_danistay',         label: 'Danıştay Kararları',          orderBy: 'meta2', ascending: false }, // meta2 = tarih
  { key: 'soru_cevap',       view: 'catalog_soru_cevap',       label: 'Soru-Cevap',                  orderBy: 'title', ascending: true },
  { key: 'mali_ansiklopedi', view: 'catalog_mali_ansiklopedi', label: 'Mali Ansiklopedi',            orderBy: 'title', ascending: true },
  { key: 'bdk',              view: 'catalog_bdk',              label: 'Beyanname Düzenleme Kılavuzu', orderBy: 'title', ascending: true },
  { key: 'gib_kaynak',       view: 'catalog_gib_kaynak',       label: 'GİB Kaynakları',              orderBy: 'title', ascending: true },
] as const;

export const CATEGORY_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** Short columns exposed by every catalog_* view (never body/embedding cols). */
export const CATALOG_COLUMNS = 'id, title, subtitle, meta1, meta2';

export interface CatalogItem {
  id: string;
  title: string | null;
  subtitle: string | null;
  meta1: string | null;
  meta2: string | null;
}

export interface CategoryCount {
  key: string;
  label: string;
  total: number;
}
