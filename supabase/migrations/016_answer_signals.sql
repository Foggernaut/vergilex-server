-- 016_answer_signals.sql
-- Persist the brain's per-answer QUALITY SIGNALS on both chat surfaces so they
-- survive a history reload, not just the live turn.
--
-- Supersedes the DEFERRED 013_message_trust.sql: this migration re-declares the
-- same trust_* columns (IF NOT EXISTS, so applying both in either order is safe)
-- AND covers `assistant_messages`, which 013 never touched.
--
-- Signals, and why each one is a SEPARATE axis:
--   trust_*        — "how well is this answer grounded in its sources?"
--                    (B12.6 composite: fidelity, citation grounding, freshness,
--                    mülga, conflicts, source tier; the raw cross-encoder
--                    confidence_score is only a small part of it)
--   position_*     — "how defensible is this position against the idare / yargı?"
--                    (source authority + conflicts → güçlü | savunulabilir |
--                    agresif | ihtilaflı). NOT a restatement of trust: a
--                    well-grounded answer can still be an aggressive position.
--   degraded/…     — graceful delivery: a blocking güvence gate stripped the
--                    unverifiable sentences instead of dropping the whole answer.
--                    degradation_note is already appended to the answer markdown;
--                    the columns let the client also render a banner.
--   clarifying_questions — machine-readable form of the answer's EKSİK BİLGİ
--                    section: dispositive party facts the question left
--                    unspecified. Empty array = nothing to clarify.
--
-- All columns are nullable / defaulted: legacy rows carry none and the client
-- falls back to what it has. Idempotent.

-- --- Mevzuat Sohbet (v1 / v2) ------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS trust_band TEXT
    CHECK (trust_band IN ('HIGH', 'MEDIUM', 'LOW', 'REJECT')),
  ADD COLUMN IF NOT EXISTS trust_score REAL,
  ADD COLUMN IF NOT EXISTS trust_explanation TEXT,
  ADD COLUMN IF NOT EXISTS position_level TEXT,
  ADD COLUMN IF NOT EXISTS position_score REAL,
  ADD COLUMN IF NOT EXISTS position_rationale TEXT,
  ADD COLUMN IF NOT EXISTS degraded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS degradation_reason TEXT,
  ADD COLUMN IF NOT EXISTS degradation_note TEXT,
  ADD COLUMN IF NOT EXISTS clarifying_questions JSONB;

-- --- Mevzuat Asistanı (3-layer) ---------------------------------------------
ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS trust_band TEXT
    CHECK (trust_band IN ('HIGH', 'MEDIUM', 'LOW', 'REJECT')),
  ADD COLUMN IF NOT EXISTS trust_score REAL,
  ADD COLUMN IF NOT EXISTS trust_explanation TEXT,
  ADD COLUMN IF NOT EXISTS position_level TEXT,
  ADD COLUMN IF NOT EXISTS position_score REAL,
  ADD COLUMN IF NOT EXISTS position_rationale TEXT,
  ADD COLUMN IF NOT EXISTS degraded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS degradation_reason TEXT,
  ADD COLUMN IF NOT EXISTS degradation_note TEXT,
  ADD COLUMN IF NOT EXISTS clarifying_questions JSONB;

-- position_level is NOT constrained by a CHECK on purpose: the brain owns that
-- vocabulary (services/position_strength.py) and a new grade there must never
-- start rejecting answer inserts here. Same reasoning as the permissive
-- source_type contract in brain.types.ts.

COMMENT ON COLUMN public.messages.position_level IS
  'Hukuki savunulabilirlik derecesi (güçlü|savunulabilir|agresif|ihtilaflı) — trust''tan ayrı eksen; brain services/position_strength.py üretir.';
COMMENT ON COLUMN public.messages.degraded IS
  'TRUE = blocking güvence kapısı cevabı düşürmek yerine doğrulanamayan ifadeleri çıkarıp teslim etti (dereceli teslim).';
COMMENT ON COLUMN public.messages.clarifying_questions IS
  'Cevabın EKSİK BİLGİ bölümünün makine-okunur hâli: sorunun belirtmediği, sonucu değiştirebilecek taraf nitelikleri (string[]).';
