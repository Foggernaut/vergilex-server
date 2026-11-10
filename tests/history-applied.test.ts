// Belge Bul geçmişi: `applied.teblig_kimlik` en çok 200 `etkilenen` bölüm taşıyabilir; geçmiş
// satırına (search_history.filters jsonb) yalnız kutunun özeti yazılır. HTTP yanıtı etkilenmez.
import { describe, expect, it } from 'vitest';
import { historyApplied } from '../src/modules/documents/historyApplied.js';
import type { BrainBrowseApplied, BrainTebligKimlik } from '../src/brain/brain.types.js';

const kutu: BrainTebligKimlik = {
  aranan: 'KDV Genel Uygulama Tebliği (Seri No: 1)',
  durum: 'ana_metne_islenmis',
  not_metni: 'Bu tebliğ ana metne işlenmiştir.',
  sabit_id: 'TEBL-19631',
  liste: [{ id: 'TEBL-1', adi: 'KDV GUT', rg_tarihi: '2014-01-01' }],
  etkilenen: Array.from({ length: 200 }, (_, i) => ({
    chunk_id: `c${i}`,
    document_id: 'TEBL-19631',
    etiket: `Bölüm ${i}`,
  })),
  etkilenen_toplam: 412,
  aile_toplam: 9,
};

// Kopyadan bir anahtarı çıkarır (kullanılmayan değişken bırakmadan).
function without<T extends object>(obj: T, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj };
  delete copy[key];
  return copy;
}

function applied(over: Partial<BrainBrowseApplied> = {}): BrainBrowseApplied {
  return {
    smart: true,
    reranked: true,
    semantic_query: 'kdv iadesi',
    keywords: ['kdv', 'iade'],
    corpora: ['teblig'],
    law_id: null,
    madde_no: null,
    daire: null,
    date_from: null,
    date_to: null,
    madde_tipi: null,
    exclude_mulga: true,
    kunye_mode: false,
    kunye_bulunan: [],
    kunye_bulunamayan: [],
    teblig_kimlik: kutu,
    ...over,
  };
}

describe('historyApplied', () => {
  it('keeps only the summary of the teblig_kimlik box', () => {
    const out = historyApplied(applied());
    expect(out.teblig_kimlik).toEqual({
      aranan: 'KDV Genel Uygulama Tebliği (Seri No: 1)',
      durum: 'ana_metne_islenmis',
      sabit_id: 'TEBL-19631',
      etkilenen_toplam: 412,
      aile_toplam: 9,
    });
    expect(out.teblig_kimlik).not.toHaveProperty('liste');
    expect(out.teblig_kimlik).not.toHaveProperty('etkilenen');
    expect(out.teblig_kimlik).not.toHaveProperty('not_metni');
  });

  it('stores null when the box is null, undefined or missing', () => {
    expect(historyApplied(applied({ teblig_kimlik: null })).teblig_kimlik).toBeNull();
    expect(historyApplied(applied({ teblig_kimlik: undefined })).teblig_kimlik).toBeNull();
    const rest = without(applied(), 'teblig_kimlik') as unknown as BrainBrowseApplied;
    expect(historyApplied(rest).teblig_kimlik).toBeNull();
  });

  it('leaves every other applied field untouched (including passthrough extras)', () => {
    const src = applied({ ...({ yeni_alan: { a: 1 } } as object) });
    const out = historyApplied(src) as Record<string, unknown>;
    expect(without(out, 'teblig_kimlik')).toEqual(without(src, 'teblig_kimlik'));
    expect(out.yeni_alan).toEqual({ a: 1 });
  });

  it('does not mutate its input (the HTTP response keeps the full box)', () => {
    const src = applied();
    historyApplied(src);
    expect(src.teblig_kimlik).toBe(kutu);
    expect(src.teblig_kimlik?.etkilenen).toHaveLength(200);
    expect(src.teblig_kimlik?.not_metni).toBe('Bu tebliğ ana metne işlenmiştir.');
  });

  it('defaults a missing sabit_id to null (jsonb-friendly)', () => {
    const noSabit = without(kutu, 'sabit_id') as unknown as BrainTebligKimlik;
    const out = historyApplied(applied({ teblig_kimlik: noSabit }));
    expect(out.teblig_kimlik?.sabit_id).toBeNull();
  });
});
