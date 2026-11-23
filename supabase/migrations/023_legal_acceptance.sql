-- 023_legal_acceptance.sql
-- KVKK md.10 / ispat yükü: kayıtta kabul edilen Kullanım Koşulları ve görülen
-- Aydınlatma Metni sürümü + zamanı (vergilex-web src/content/legal.ts `version`).
-- Signup controller service_role ile yazar. Mevcut kullanıcılar NULL kalır →
-- metin yayınlandığında yeniden onay akışı bu kolonlara bakar.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terms_version          TEXT,
  ADD COLUMN IF NOT EXISTS privacy_notice_version TEXT,
  ADD COLUMN IF NOT EXISTS terms_accepted_at      TIMESTAMPTZ;
