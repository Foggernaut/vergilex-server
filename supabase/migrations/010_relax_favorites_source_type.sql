-- 010_relax_favorites_source_type.sql
-- The brain (mevzuat-knowledge-api) expanded the DocumentResult.source_type enum
-- from 5 → 9 values and will keep adding corpora over time
-- (added: ansiklopedi, makale, bdk, danistay_karar). The original CHECK in
-- 004_favorites.sql hard-codes the 5 legacy values, so favoriting a source with
-- a new type fails the constraint. Drop the CHECK and keep source_type as a free
-- TEXT column — validation lives in the app layer (cachedDataSchema), matching
-- the permissive z.string() contract used for brain responses.

ALTER TABLE public.favorites
  DROP CONSTRAINT IF EXISTS favorites_source_type_check;
