-- 026_assistant_notlar.sql
-- Asistan notları (2026-11-26): beyin NOT_KIPI=yapisal iken otomatik teyit/kapsam notlarını mütalaa METNİNDEN
-- çıkarıp yapısal `notlar` alanında döner: [{tur, metin, onem: bilgi|uyari|kritik, kaynak_no}]. Sohbetteki
-- messages.notlar (025) ile aynı biçim; eski satırlarda NULL kalır (web kutuyu çizmez, notlar metindedir).
--
-- SIRA: bu SQL ürün DB'sinde server deploy'undan ÖNCE çalıştırılmalı; beyinde NOT_KIPI=yapisal ancak server + web
-- + bu migration canlıdayken açılır. Unutulursa server yalnız eksik kolonsuz tekrar dener (src/utils/optionalColumn.ts)
-- — kayıt kırılmaz, canlı turda notlar yine görünür; ama geçmişten açılan Asistan konuşmasında GÖRÜNMEZ. Idempotent.
--
-- YETKİ (022 + 024 ile birlikte): ek GRANT gerekmez ve verilmemeli. Yeni kolon tablo düzeyi yetkiyi miras alır:
-- server okur/yazar (supabaseAdmin = service_role); anon/authenticated 022+024 sonrası assistant_messages'ta hiçbir
-- yetkiye sahip değil, web bu alanı yalnız server API'sinden alır.
-- KVKK silme: Asistan sohbeti silinince assistant_messages CASCADE ile gider (src/jobs/retention.ts) — bu kolon da.

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS notlar JSONB;
