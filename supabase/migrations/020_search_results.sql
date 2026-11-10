-- 020_search_results.sql
-- Belge Bul Geçmiş: aramanın tam yanıtı kısa süre saklanır (varsayılan 7 gün, sunucu env
-- BELGE_BUL_SONUC_SAKLAMA_GUN), geçmişten tıklanınca kredisiz açılır. Ayrı tablo: search_history
-- (liste) hafif kalsın; liste uç noktası `response`'u hiç okumaz.
--
-- Geri alma: DROP TABLE public.search_results;
--
-- SIRA: bu SQL ürün DB'sinde server deploy'undan ÖNCE çalıştırılmalı. Unutulursa sunucu kayıtta ve
-- okumada hata yutar (fail-open): Belge Bul ve Geçmiş çalışır, yalnız sonuçlar saklanmaz.
-- Satırları sunucu service key ile yazar/siler (süresi dolanlar her yeni kayıtta toplu silinir,
-- pg_cron yok); okumada süre ayrıca denetlenir. Idempotent.

CREATE TABLE IF NOT EXISTS public.search_results (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    history_id  UUID NOT NULL UNIQUE REFERENCES public.search_history(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    request     JSONB,                       -- {query, filters, per_corpus, smart, rerank}
    response    JSONB NOT NULL,              -- beynin tam yanıtı (newBalance hariç)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_results_user_created
  ON public.search_results(user_id, created_at DESC);

-- Toplu temizlik (created_at < eşik, tüm kullanıcılar) bu indeksle taranır.
CREATE INDEX IF NOT EXISTS idx_search_results_created
  ON public.search_results(created_at);

ALTER TABLE public.search_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS results_select_own ON public.search_results;
CREATE POLICY results_select_own ON public.search_results
  FOR SELECT USING (auth.uid() = user_id);
