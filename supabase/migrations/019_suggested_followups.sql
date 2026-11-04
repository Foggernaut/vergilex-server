-- 019_suggested_followups.sql
-- Takip sorusu önerileri (Sohbet): beynin cevapla birlikte döndürdüğü en fazla 3 soru. Web bunları
-- son cevabın altında, TAKİP SORUSU kutusunun üstünde baloncuk olarak gösterir (basınca kutuya
-- yazılır, gönderilmez). Sohbet yeniden açılınca son cevabın önerileri buradan gelir. Boş liste
-- NULL saklanır; eski satırlarda NULL kalır (web öneri göstermez). Yalnız Sohbet (`messages`):
-- 3 Aşamalı (`assistant_messages`) öneri üretmez.
--
-- SIRA: bu SQL ürün DB'sinde server deploy'undan ÖNCE çalıştırılmalı. Unutulursa server
-- yalnız bu kolonu atlayıp tekrar dener (src/utils/optionalColumn.ts withOptionalColumns) —
-- kayıt kırılmaz, diğer kolonlar korunur, yalnız öneriler geçmişte saklanmaz.
-- Idempotent.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS suggested_followups JSONB;

COMMENT ON COLUMN public.messages.suggested_followups IS
  'Takip sorusu önerileri (beyin suggested_followups, en fazla 3 soru); boş = NULL.';
