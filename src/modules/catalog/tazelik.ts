import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../config/logger.js';
import { CATEGORIES, CATEGORY_BY_KEY, type CategoryCount, type KategoriTazelik } from './catalog.types.js';

// Veri tazeliği — "Sistemdeki Belgeler" (spec: mevzuat_knowledge-db-1
// docs/superpowers/specs/2026-11-22-veri-tazeligi-design.md). Mevzuat DB'deki `korpus_tazelik` view'ı
// (migration 066) korpus başına son güncelleme / en yeni belge / son 30 günde eklenen döner. Gösterim
// SISTEM_BELGELER_TAZELIK ayarına bağlı (virgüllü kategori anahtarları); boşken view hiç sorgulanmaz ve
// yanıt bugünküyle birebir aynıdır.

/** `korpus_tazelik` view satırı (ham). */
export interface KorpusTazelikRow {
  korpus: 'danistay' | 'ozelge';
  son_guncelleme: string; // timestamptz ISO
  en_yeni_belge: string | null; // date
  son_30_gun_eklenen: number;
}

const ISTANBUL_GUN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }); // → YYYY-MM-DD

/** Ayar değerinden açık kategori anahtarları: yalnız tazelikKorpus'u olan kategoriler. */
export function parseTazelikKeys(raw: string | undefined): Set<string> {
  const izinli = new Set(CATEGORIES.filter((c) => c.tazelikKorpus).map((c) => c.key));
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((k) => izinli.has(k))
  );
}

/** Tazelik satırlarını oku. Ayar boşsa sorgu YOK; hata → uyarı + boş (sayfa düşmez). */
export async function tazelikOku(
  keys: Set<string>,
  client: Pick<SupabaseClient, 'from'>
): Promise<KorpusTazelikRow[]> {
  if (keys.size === 0) return [];
  try {
    const { data, error } = await client
      .from('korpus_tazelik')
      .select('korpus, son_guncelleme, en_yeni_belge, son_30_gun_eklenen');
    if (error) throw error;
    return (data ?? []) as KorpusTazelikRow[];
  } catch (err) {
    // PostgrestError düz nesnedir (Error değil): String(err) '[object Object]' verirdi.
    const mesaj = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    logger.warn('korpus_tazelik okunamadı — tazelik gösterilmiyor', { err: mesaj });
    return [];
  }
}

/** Açık ve satırı olan kategorilere `tazelik` ekle; diğerleri birebir kalır. */
export function tazelikEkle(
  categories: CategoryCount[],
  rows: KorpusTazelikRow[],
  keys: Set<string>
): CategoryCount[] {
  if (keys.size === 0 || rows.length === 0) return categories;
  const byKorpus = new Map(rows.map((r) => [r.korpus, r]));
  return categories.map((c) => {
    const korpus = CATEGORY_BY_KEY.get(c.key)?.tazelikKorpus;
    const row = korpus && keys.has(c.key) ? byKorpus.get(korpus) : undefined;
    if (!row) return c;
    const tazelik: KategoriTazelik = {
      son_guncelleme: ISTANBUL_GUN.format(new Date(row.son_guncelleme)),
      en_yeni_belge: row.en_yeni_belge ? row.en_yeni_belge.slice(0, 10) : null,
      son_30_gun_eklenen: Number(row.son_30_gun_eklenen) || 0,
    };
    return { ...c, tazelik };
  });
}
