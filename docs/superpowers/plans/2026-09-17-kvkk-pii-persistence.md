# KVKK PII — Persistence & Relay Plan (vergilex-server)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server tarafında (a) brain'den gelen yeni `pii_*` alanlarını taşımak, (b) log'lara ham sorgu/cevap sızmadığını garanti etmek, (c) "kalıcı yazım politikası" kararına göre `messages` tablosuna **maskeli** içerik yazma seçeneğini (Karar B) hazır tutmak — **TS tarafında maskeleme mantığı yazmadan.**

**Architecture:** Server salt taşıyıcı kalır. Maskeleme/geri açma yalnız brain'dedir (`mevzuat-knowledge-api/services/llm_gateway.py`). Server, brain cevabındaki `pii_masked_query` / `pii_masked_answer` alanlarını **isteğe bağlı** olarak `messages.content`'e yazar; history yükleyici (`loadHistorySinceBoundary`) değişmez — placeholder'lı history brain'e gider, brain'in HMAC-stabil placeholder'ları sayesinde aynı değer aynı etiketi alır.

**Tech Stack:** Node ≥20, TypeScript, Express, zod, supabase-js, winston, vitest (`npm test`).

**Spec:** `mevzuat-knowledge-api/docs/superpowers/plans/2026-09-17-kvkk-pii-egress-masking.md` (§0 Spec özeti, "Açık kararlar" 1). Bu plan o planın Task 1.7'sine (cevap alanları) bağımlıdır.

## Global Constraints

- **Server'da PII tespit/maskeleme kodu yazılmaz.** Tek kaynak brain. (Kopya = iki yerde bakım = tutarsızlık.)
- SSE relay (`src/brain/brain.client.ts:123-234`, `src/modules/chat/chat.stream.service.ts`, `src/modules/assistant/assistant.stream.service.ts`) **değişmez**: `answer_delta` / `layer3_delta` / `complete` olduğu gibi geçer.
- Log'larda sorgu/cevap metni **yok**: yalnız uzunluk + kısa hash (`redactForLog`).
- zod şeması geriye uyumlu: yeni alanlar `.optional()` — eski brain sürümüyle parse bozulmaz.
- Commit stili: `feat(kvkk): …`, `chore(kvkk): …`, `test(kvkk): …`.

---

## §0 Doğrulanmış bulgular (HEAD `27889c7`)

| # | Bulgu | Kanıt |
|---|---|---|
| S1 | Ham kullanıcı sorgusu `messages.content`'e yazılıyor; history buradan okunup brain'e maskesiz gidiyor. | `src/modules/chat/chat.service.ts:215-221` (startConversation), `:355-361` (followUp); `loadHistorySinceBoundary` `:33-61` |
| S2 | Server'da AI SDK yok; `package.json` deps: supabase-js, express, undici, zod, winston, ws, resend, multer. | `package.json` |
| S3 | `chat.stream.service.ts:28,131` ve `assistant.stream.service.ts:23`'teki "masked" ifadesi **faz etiketi**, PII değil. | ilgili satırlar |
| S4 | Brain cevabı `BrainAnswerResponseSchema` ile parse ediliyor; bilinmeyen alanlar zod default davranışıyla düşer. | `src/brain/brain.types.ts:206-236` |

---

## Karar: `messages` tablosuna ne yazılır?

| Seçenek | Ne yapar | Artı | Eksi |
|---|---|---|---|
| **A — Ham (bugünkü)** | `content = args.query` | UX değişmez; iş yok | Supabase bölgesi TR dışıysa m.9 aktarımı; LLM'i maskeleyip DB'yi ham tutmak tutarsız |
| **B — Maskeli** | `content = answer.pii_masked_query ?? args.query` (user), `answer.pii_masked_answer ?? answer.answer` (assistant) | DB'de ham PII yok; history brain'e maskeli gider (HMAC-stabil placeholder → tutarlı akıl yürütme) | Kullanıcı sayfayı yenileyince eski mesajlarda `[TCKN_a3f2c1]` görür (web planı Task 3 bunu okunur çip'e çevirir); map saklanmadığı için geri açılamaz |
| C — Maskeli + kasa | B + `pii_vault` tablosu (şifreli) | Tam geri açma | Kasa aynı DB/bölgede → anahtar dışarıda (KMS) değilse tiyatro; en fazla iş |

**Öneri:** Supabase bölgesi kontrol edilsin (Task 1). TR dışındaysa **B**; TR içindeyse A + aydınlatma metni. C önerilmiyor.

---

### Task 1: Supabase bölgesi tespiti (ops, kod yok)

- [ ] **Step 1:** `.env`'deki `SUPABASE_URL` proje ref'ini al; Supabase Dashboard → Project Settings → General → **Region**. Audit projesi (`SUPABASE_AUDIT_PROJECT_URL`, brain `.env`) için aynı kontrol.
- [ ] **Step 2:** Sonucu bu dosyanın altındaki "Karar kaydı" bölümüne yaz (tarih, bölge, karar A/B).
- [ ] **Step 3:** Commit: `docs(kvkk): supabase bölgesi + saklama kararı`.

---

### Task 2: zod şemasına `pii_*` alanları (geriye uyumlu)

**Files:**
- Modify: `src/brain/brain.types.ts:206-236` (`BrainAnswerResponseSchema`)
- Test: `src/brain/brain.types.test.ts` (yeni)

**Interfaces:**
- Consumes: brain Task 1.7 alanları: `pii_count:int`, `pii_kinds:{[k]:int}|null`, `pii_masked_query:str|null`, `pii_masked_answer:str|null`, `pii_special_flag:bool`, `pii_special_categories:str[]`.
- Produces: `BrainAnswerResponse` tipinde aynı isimli opsiyonel alanlar.

- [ ] **Step 1: Failing test** — `src/brain/brain.types.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { BrainAnswerResponseSchema } from './brain.types';

const base = {
  answer: 'x', sources: [], conflicts: [], confidence_score: 0.5,
  tokens_used: { prompt: 1, completion: 1 }, not_found: false, secondary_legislation_note: null,
};

describe('BrainAnswerResponseSchema pii fields', () => {
  it('parses legacy payload without pii fields', () => {
    const r = BrainAnswerResponseSchema.parse(base);
    expect(r.pii_count).toBe(0);
    expect(r.pii_masked_query).toBeUndefined();
  });
  it('carries pii fields when present', () => {
    const r = BrainAnswerResponseSchema.parse({
      ...base, pii_count: 2, pii_kinds: { TCKN: 1, TEL: 1 },
      pii_masked_query: 'soru [TCKN_a3f2c1]', pii_masked_answer: 'cevap [TCKN_a3f2c1]',
      pii_special_flag: true, pii_special_categories: ['saglik'],
    });
    expect(r.pii_kinds?.TCKN).toBe(1);
    expect(r.pii_special_categories).toEqual(['saglik']);
  });
});
```
- [ ] **Step 2: Fail gör** — `npm test -- brain.types` → FAIL (`pii_count` undefined, beklenen 0).
- [ ] **Step 3: Şema** — `BrainAnswerResponseSchema` içine, `context_mode` satırının altına:
```ts
  // KVKK (brain Task 1.7) — optional/defaulted so older brain builds still parse.
  pii_count: z.number().int().default(0),
  pii_kinds: z.record(z.number().int()).nullable().optional(),
  pii_masked_query: z.string().nullable().optional(),
  pii_masked_answer: z.string().nullable().optional(),
  pii_special_flag: z.boolean().default(false),
  pii_special_categories: z.array(z.string()).default([]),
```
- [ ] **Step 4: Geç** — `npm test -- brain.types` → PASS.
- [ ] **Step 5: Commit** — `git add src/brain/brain.types.ts src/brain/brain.types.test.ts && git commit -m "feat(kvkk): brain cevabındaki pii_* alanlarını taşı (opsiyonel, geriye uyumlu)"`

---

### Task 3: Log hijyeni — `redactForLog`

**Files:**
- Create: `src/lib/redact.ts`
- Test: `src/lib/redact.test.ts`
- Modify: `grep -rn "logger\.\(info\|warn\|error\|debug\)" src | grep -i "query\|content\|answer"` ile bulunan her log satırı

- [ ] **Step 1: Failing test** — `src/lib/redact.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { redactForLog } from './redact';

describe('redactForLog', () => {
  it('never returns the text itself', () => {
    const out = redactForLog('Müvekkilim 10000000146 TCKN');
    expect(out).not.toContain('10000000146');
    expect(out).toMatch(/^len=\d+ h=[0-9a-f]{8}$/);
  });
  it('handles empty', () => {
    expect(redactForLog('')).toBe('len=0 h=00000000');
    expect(redactForLog(undefined)).toBe('len=0 h=00000000');
  });
});
```
- [ ] **Step 2: Fail gör** — `npm test -- redact` → module not found.
- [ ] **Step 3: Implementasyon** — `src/lib/redact.ts`
```ts
import { createHash } from 'node:crypto';

/** Log'a metin değil, uzunluk + kısa hash yaz (KVKK: log'da PII yok). */
export function redactForLog(text: string | null | undefined): string {
  const t = text ?? '';
  if (!t) return 'len=0 h=00000000';
  const h = createHash('sha256').update(t).digest('hex').slice(0, 8);
  return `len=${t.length} h=${h}`;
}
```
- [ ] **Step 4:** Bulunan log satırlarında `query`/`content`/`answer` değişkenlerini `redactForLog(x)` ile sar. Değişen her dosyayı commit mesajında listele.
- [ ] **Step 5: Geç** — `npm test` → PASS. **Step 6: Commit** — `chore(kvkk): log'larda sorgu/cevap metni yerine len+hash`.

---

### Task 4: Karar B — `messages`'a maskeli yaz (yalnız Karar B seçilirse)

**Files:**
- Modify: `src/modules/chat/chat.service.ts:215-221, :232-238, :355-361, :376-382`
- Modify: `src/modules/assistant/assistant.service.ts` (aynı iki insert; `grep -n "from('messages')"`)
- Test: `src/modules/chat/chat.service.test.ts` (yeni; supabaseAdmin mock'lu)

**Interfaces:**
- Consumes: `BrainAnswerResponse.pii_masked_query`, `.pii_masked_answer` (Task 2).
- Sözleşme: `content = answer.pii_masked_query ?? args.query`; `content = answer.pii_masked_answer ?? answer.answer`. Brain eski sürümse (`null/undefined`) ham yazılır (davranış A'ya düşer; log'a `warn` yaz).

- [ ] **Step 1: Failing test** — `chat.service.test.ts`: `supabaseAdmin.from('messages').insert` mock'la; `startConversation` çağır; `insert` argümanında `content` = `pii_masked_query`. İkinci test: `pii_masked_query` yoksa ham `args.query`.
- [ ] **Step 2: Fail gör** — `npm test -- chat.service`.
- [ ] **Step 3: Implementasyon** — `:219` `content: args.query` → `content: answer.pii_masked_query ?? args.query`; `:236` `content: answer.answer` → `content: answer.pii_masked_answer ?? answer.answer`; `:359/:380` aynı. Yardımcı:
```ts
function persistedContent(masked: string | null | undefined, raw: string): string {
  if (masked == null) logger.warn('pii_masked_* eksik — ham içerik yazılıyor (brain sürümü eski?)');
  return masked ?? raw;
}
```
- [ ] **Step 4: Geç + Commit** — `feat(kvkk): messages tablosuna maskeli içerik (Karar B)`.
- [ ] **Step 5: Web planı Task 3** (placeholder çip'i) bununla **aynı gün** çıkar; yoksa kullanıcı ham `[TCKN_…]` görür.

**Not:** `loadHistorySinceBoundary` **değişmez**. Placeholder'lı history brain'e gider; brain gateway'i egress'te vault + yapısal katmanla yeniden maskeler; aynı değer aynı HMAC etiketini aldığı için 1. turdaki `[TCKN_a3f2c1]` ile 2. turda kullanıcının yeniden yazdığı TCKN aynı etikete düşer.

---

### Task 5: Cutover sonrası doğrulama (manuel)

- [ ] Yeni bir konuşma: TCKN + IBAN içeren soru → `messages` tablosunda `content` (Karar B ise) placeholder'lı; `pii_count` brain audit'inde > 0.
- [ ] `grep -rn "10000000146" logs/` (veya Railway log araması) → 0 sonuç.
- [ ] Follow-up turunda brain audit `pii_kinds` aynı tipleri gösteriyor (history'den yakalanmış).

---

## Karar kaydı
- 2026-09-17: bölge — _(Task 1 ile doldurulacak)_; karar — _(A/B)_.
