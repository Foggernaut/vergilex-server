-- 016_kaynak_envanteri.sql
-- Araştırma protokolü (Faz 5): kaynak envanterini cevapla birlikte sakla — tür başına
-- arandı / bulundu / sentezde sayımı ve "neden yok" (kısıt, kapalı korpus, teknik hata,
-- sonuç yok). Cevap metnindeki "Taranan kaynaklar:" satırının yapısal hâli; web bunu
-- gruplu kutu olarak gösterir. Eski satırlarda NULL kalır (web metin satırını gösterir).
--
-- SIRA: bu SQL ürün DB'sinde server deploy'undan ÖNCE çalıştırılmalı. Unutulursa server
-- kodu kolonsuz tekrar dener (src/utils/optionalColumn.ts) — kayıt kırılmaz, yalnız
-- envanter geçmişte saklanmaz.
-- Idempotent.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS kaynak_envanteri JSONB;

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS kaynak_envanteri JSONB;
