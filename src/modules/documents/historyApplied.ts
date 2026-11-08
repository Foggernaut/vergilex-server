import type { BrainBrowseApplied, BrainTebligKimlik } from '../../brain/brain.types.js';

// search_history.filters.applied.teblig_kimlik: yalnız kutunun özeti (liste / etkilenen / not_metni
// geçmişe yazılmaz — `etkilenen` 200 bölüme çıkabilir ve jsonb'yi şişirir).
export type TebligKimlikOzet = Pick<
  BrainTebligKimlik,
  'aranan' | 'durum' | 'etkilenen_toplam' | 'aile_toplam'
> & { sabit_id: string | null };

export type HistoryApplied<T> = Omit<T, 'teblig_kimlik'> & { teblig_kimlik: TebligKimlikOzet | null };

/** Geçmişe yazılacak `applied` kopyası. Girdi değişmez; HTTP yanıtı tam kutuyu taşımaya devam eder. */
export function historyApplied<T extends Pick<BrainBrowseApplied, 'teblig_kimlik'>>(
  applied: T
): HistoryApplied<T> {
  const { teblig_kimlik: kutu, ...rest } = applied;
  return {
    ...rest,
    teblig_kimlik: kutu
      ? {
          aranan: kutu.aranan,
          durum: kutu.durum,
          sabit_id: kutu.sabit_id ?? null,
          etkilenen_toplam: kutu.etkilenen_toplam,
          aile_toplam: kutu.aile_toplam,
        }
      : null,
  };
}
