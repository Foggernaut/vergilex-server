-- 017_answer_sonuc_durumu.sql
-- Persist the brain's one-glance verdict label (`sonuc_durumu`) on both chat
-- surfaces so it survives a history reload, not just the live turn. Companion to
-- 016_answer_signals.sql; independent of it (IF NOT EXISTS, either order is safe).
--
-- Today's values: 'kesin değerlendirme' | 'ihtimal' | 'ek bilgi gerekli'.
-- Deliberately NOT constrained by a CHECK: the brain owns that vocabulary and a
-- new label there must never start rejecting answer inserts here (same reasoning
-- as position_level in 016).
--
-- OPTIONAL: the app works without it. The server retries message inserts and
-- reads without the signal columns when they are missing, so applying this later
-- loses nothing but the persisted label. Legacy rows carry NULL and the client
-- falls back to what it has. Idempotent.
--
-- (The brain's `hesap` object — structured tax-calculation result — is NOT
-- persisted: its human-readable breakdown is already part of the answer markdown.)

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sonuc_durumu TEXT;

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS sonuc_durumu TEXT;

COMMENT ON COLUMN public.messages.sonuc_durumu IS
  'Tek bakışta sonuç etiketi (kesin değerlendirme|ihtimal|ek bilgi gerekli) — brain üretir; kelime dağarcığı brain''e aittir, CHECK yok.';
COMMENT ON COLUMN public.assistant_messages.sonuc_durumu IS
  'Tek bakışta sonuç etiketi (kesin değerlendirme|ihtimal|ek bilgi gerekli) — brain üretir; kelime dağarcığı brain''e aittir, CHECK yok.';
