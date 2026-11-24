-- 025_kaynak_dokumu_notlar.sql
-- Faz 4a (2026-11-24): Sohbet cevabının iki parçası METİNDEN yapısal alana taşındı —
--   kaynak_dokumu: karar ve muktezaların yöne göre özeti (cevabın altında ayrı kutu)
--                  [{kategori, yon: olumlu|olumsuz|karma|bilinmiyor, kaynaklar: [{kunye, kaynak_no: [int], ayrinti}]}]
--   notlar:        otomatik teyit / kapsam notları [{tur, metin, onem: bilgi|uyari|kritik, kaynak_no}]
-- Beyin bunları yalnız DOKUM_KIPI / NOT_KIPI = yapisal iken döner; eski satırlarda NULL kalır (web kutuları
-- göstermez, tablo zaten cevabın içindedir).
--
-- SIRA: bu SQL ürün DB'sinde server deploy'undan ÖNCE çalıştırılmalı. Unutulursa server yalnız eksik
-- kolonsuz tekrar dener (src/utils/optionalColumn.ts) — kayıt kırılmaz; bu alanlar geçmişte saklanmaz,
-- canlı turda yine görünür. DİKKAT: beyin yapisal kipteyken kolon yoksa, geçmişten açılan konuşmada
-- kaynak dökümü ve notlar GÖRÜNMEZ (metinde de yoktur). Idempotent.
--
-- YETKİ (022 + 024 ile birlikte): ek GRANT gerekmez ve verilmemeli. Yeni kolonlar tablo düzeyi yetkiyi
-- miras alır: server okur/yazar (supabaseAdmin = service_role); anon/authenticated 022+024 sonrası
-- messages'ta hiçbir yetkiye sahip değil, web bu alanları yalnız server API'sinden alır.
-- KVKK silme: sohbet silinince messages CASCADE ile gider (src/jobs/retention.ts) — bu kolonlar da.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS kaynak_dokumu JSONB,
  ADD COLUMN IF NOT EXISTS notlar JSONB;
