-- 021_atif_kontrolu_kapsam_notu.sql
-- Radar 2026-11-20: Sohbet (asistan) cevabıyla birlikte iki yapısal alanı sakla —
--   atif_kontrolu: cevaptaki her madde / karar / özelge atfının doğrulama durumu
--                  [{atif, tur, durum: dogrulandi|incelenmeli|sorunlu, neden}]
--   kapsam_notu:   "Taranan kaynaklar" kutusu {kaynaklar: [{tur, ad, durum, sentez, tarih, tarih_turu, eski}],
--                  uyarilar: [...]}
-- Eski satırlarda NULL kalır (web kutuları göstermez / envanter kutusuna düşer).
--
-- SIRA: bu SQL ürün DB'sinde server deploy'undan ÖNCE çalıştırılmalı. Unutulursa server kodu yalnız
-- eksik kolonsuz tekrar dener (src/utils/optionalColumn.ts withOptionalColumns) — kayıt kırılmaz,
-- yalnız bu alanlar geçmişte saklanmaz (canlı turda yine görünür).
-- Idempotent. messages (eski /answer yolu) da aynı şemayı taşısın diye eklenir.

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS atif_kontrolu JSONB,
  ADD COLUMN IF NOT EXISTS kapsam_notu JSONB;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS atif_kontrolu JSONB,
  ADD COLUMN IF NOT EXISTS kapsam_notu JSONB;
