# Belge Bul Geçmiş — kayıtlı sonuçlar Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Belge Bul Geçmiş'te tıklanan bir aramanın sonuçları 7 gün boyunca kredisiz ve anında geri gelsin. Daha eski ya da kaydı olmayan bir aramaya tıklanınca arama aynı filtrelerle yeniden çalışsın (2 KR).

**Architecture:**
- **Sunucu:** Belge Bul yanıtı yeni `search_results` tablosuna (app DB, migration 020) kaydedilir. Kayıt ölümcül değildir, bozuk ya da boş yanıt kaydedilmez, her kayıtta süresi dolmuşlar silinir. Kullanıcının isteği (`request`) kalıcı `search_history.filters.request` içine de yazılır. Geçmiş listesi `has_results` döner; kayıtlı yanıt için yeni bir GET uç noktası eklenir.
- **Web:** Geçmiş satırı tıklanınca:
  - kayıt varsa store'a yüklenir ve Belge Bul'da bir notla gösterilir;
  - yoksa store'a "otomatik çalıştır" bayrağı konur ve Belge Bul açılışta aramayı çalıştırır.

**Tech Stack:** Express + zod + supabase-js (service key) + vitest + supertest · Vue 3 + Pinia + vitest + @vue/test-utils.

**Spec:** `docs/superpowers/specs/2026-11-10-belge-bul-gecmis-sonuc-design.md` (§7 bağlayıcı). Kaynak scratchpad'deki aynı adlı dosya; S0 sunucu worktree'sine kopyalar.

## Global Constraints

- **Dal ve PR:** dal adı `feat/belge-bul-gecmis-sonuc`. Sunucu PR'ı → `main`, web PR'ı → `main` (yalnız Atilla merge eder). Depo başına tek PR.
- **Worktree'ler:** `~/Desktop/mevzuat/server-gecmis` (origin/main) ve `~/Desktop/mevzuat/web-gecmis` (origin/main). Ana klasörlere dokunulmaz. Önce `git fetch`.
- **Saklama:** sunucu env `BELGE_BUL_SONUC_SAKLAMA_GUN`, varsayılan **7**; **0 = saklama kapalı**.
- **Kaydedilmeyen yanıtlar:** `documents.length === 0`, ya da `kaynak_envanteri.gruplar[].korpuslar[]` içinde `durum === 'hata'` olan bir korpus varsa.
- **Kayıt hatası** istemci yanıtını asla bozmaz. Tablo yokken de Belge Bul çalışır.
- **Sınırlar:**
  - Liste uç noktası `search_results.response`'u **asla** okumaz.
  - `/history/:id/results` yalnız sahibine ve süresi dolmamışsa döner, aksi halde 404. Kredi düşmez.
  - Hız sınırı ayarlarına ve beyne dokunulmaz.
- **Arayüz metinleri (birebir):**
  - not: `Bu sonuçlar {gg Ay yyyy ss:dd} tarihli aramanın kayıtlı halidir.`
  - düğme: `YENİDEN ÇALIŞTIR (2 KR)`
  - Geçmiş etiketleri: `KAYITLI` · `2 KR · YENİDEN ÇALIŞIR`
- **Testler ve kontroller:**
  - Testler gerçek fonksiyonlar üzerinde; Supabase sahte istemcisi `tests/find-documents-history.test.ts` desenindedir.
  - Sunucu: `npm test && npm run typecheck && npm run lint`.
  - Web: `npm test && npm run build`. Web lint main'de kırık, `typecheck` no-op; tip kapısı `vue-tsc -b`.
- **Commit:** mesaj Türkçe, sonunda `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push yok (V'de kullanıcı onayıyla). `tsbuildinfo` commit'lenmez.

## Review Focus

- **Geri tuşuyla tekrar ücret:** otomatik çalıştırma bayrağı tek kullanımlık olmalı. GERİ, F5 ya da Belge Bul'a başka yoldan gelişte arama ikinci kez çalışmamalı. → W1 testi.
- **Başkasının kaydı:** başka kullanıcıya ait `history_id` ile `/results` → 404 (veri sızıntısı yok). → S1 testi.
- **Süre sınırında okuma:** kayıt hâlâ tabloda ama süresi dolmuşsa okumada 404 dönmeli ve listede `has_results:false` görünmeli. → S1 testi.
- **Büyük yanıt:** yaklaşık 100–600 KB'lık yanıt eklenirken istemciye dönüş gecikmemeli ve hata yutulmalı. → S1'de ölçüm + test; V'de gerçek boyut.
- **Kayıtlı sonuçta eski not kalması:** yeni bir arama yapılınca kayıtlı not kalkmalı; kayıtlı sonuç açılınca seçim ve liste durumu sıfırlanmalı. → W1 testi.

---

## Task S0: Çalışma alanı + belgeler

- [ ] **Step 1:** superpowers:using-git-worktrees ile `server-gecmis` ve `web-gecmis` worktree'lerini aç (dal `feat/belge-bul-gecmis-sonuc`, taban `origin/main`). Ardından:
  - `.env` dosyalarını ana klasörlerden kopyala;
  - her iki worktree'de `npm ci`;
  - taban testleri: sunucu 91, web 290.
- [ ] **Step 2:** Spec'i ve bu planı `server-gecmis/docs/superpowers/{specs,plans}/` altına kopyala. Commit: `docs: Belge Bul geçmiş kayıtlı sonuçlar tasarım + plan`.

## Task S1: Sunucu — tablo, kayıt, liste etiketi, kayıtlı yanıt uç noktası

**Files:**
- Create:
  - `supabase/migrations/020_search_results.sql`
  - `src/modules/documents/searchResults.ts`
  - `tests/search-results.test.ts`
- Modify:
  - `src/config/env.ts` (`BELGE_BUL_SONUC_SAKLAMA_GUN: z.coerce.number().int().nonnegative().default(7)`)
  - `src/modules/documents/documents.controller.ts`
  - `src/modules/documents/documents.routes.ts`
  - `tests/find-documents-history.test.ts` (yeni davranışlar)

**Interfaces:**
- Produces (web bunu kullanır):
  - `POST /api/belge-bul` yanıtına `history_id: string | null` eklenir.
  - `GET /api/belge-bul/history` öğeleri: `{ id, query, filters, results_count, created_at, has_results: boolean }`. `filters.request` = `{ filters?, per_corpus?, smart?, rerank? }`; bu sürümden itibaren yazılır.
  - `GET /api/belge-bul/history/:id/results` → `200 { query: string, created_at: string, request: {...} | null, response: <FindDocumentsResponse without newBalance> }` ya da `404`.
- `searchResults.ts` dışa aktarır:
  - `function sonucKaydedilmeli(r: BrainBrowseDocumentsResponse): boolean`
  - `async function sonucuKaydet(a: { historyId: string; userId: string; request: unknown; response: unknown }): Promise<void>`: ekler, sonra `created_at < now - gün` olan TÜM satırları siler. Hataları yutar ve günlüğe yazar.
  - `async function kayitliSonuc(historyId: string, userId: string): Promise<{ created_at: string; request: unknown; response: unknown } | null>`: sahiplik ve süre denetimi yapar.
  - `async function kayitliSonucIdleri(historyIds: string[], userId: string): Promise<Set<string>>`: yalnız `history_id, created_at` seçer, süresi dolmamışları döner.
  - Saklama `0` iken hepsi no-op'tur: kaydet hiçbir şey yapmaz, okumalar boş ya da null döner.

**Migration 020 içeriği:**
- `CREATE TABLE IF NOT EXISTS public.search_results` (sütunlar spec §3'teki gibi).
- `history_id` UNIQUE + FK `ON DELETE CASCADE`; `user_id` FK.
- İndeksler: `(user_id, created_at DESC)` ve `(created_at)`.
- `ENABLE ROW LEVEL SECURITY` + `results_select_own` politikası (005 deseni).
- Dosyanın başında yorum: "Geri alma: DROP TABLE public.search_results;".

- [ ] **Step 1: Failing tests** (`tests/search-results.test.ts`; sahte supabase, `vi.useFakeTimers` ile saat)
  - `sonucKaydedilmeli`:
    - 0 belge → false;
    - `hata` korpus → false;
    - normal yanıt → true;
    - künye modu (`kaynak_envanteri: null`, belge var) → true.
  - `sonucuKaydet`:
    - doğru tabloya `{history_id, user_id, request, response}` ekler;
    - eşik `now - 7 gün` ile tüm kullanıcılar için `created_at < eşik` silmesi yapar;
    - insert hata verirse fırlatmaz.
  - `kayitliSonuc`:
    - sahibine ve 7 gün içinde → döner;
    - başka kullanıcı → null;
    - 8 günlük kayıt → null.
  - `kayitliSonucIdleri`: yalnız taze olanlar; sorgu `response` sütununu SEÇMEZ (select argümanı denetlenir).
  - Saklama 0: kaydet çağrısı supabase'e hiç gitmez.
  - Controller (`find-documents-history.test.ts` deseni, gerçek `findDocuments`):
    - history insert'ten `id` alınır;
    - yanıt `history_id` taşır;
    - `filters.request` yazılır;
    - `search_results` insert'i patlarsa yanıt yine 200 ve tam;
    - boş yanıtta `search_results` insert'i yapılmaz.
  - `getDocumentHistory` öğeleri `has_results` taşır.
  - Yeni `getSavedResults`: 200 / başka kullanıcı 404 / süresi dolmuş 404 / kredi düşmez (`deductCredits` çağrılmaz).
- [ ] **Step 2:** `npx vitest run tests/search-results.test.ts tests/find-documents-history.test.ts` → FAIL.
- [ ] **Step 3:** Yaz. Rota: `documentsRouter.get('/history/:id/results', getSavedResults)`. `:id` uuid değilse 404.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run lint` → PASS (91 + yeni).
- [ ] **Step 5:** Commit'ler:
  - `feat(belge-bul): arama sonuçları 7 gün saklanır (search_results, 020)`
  - (gerekirse) ayrı bir test commit'i.

## Task W1: Web — Geçmiş tıklaması, kayıtlı sonuç notu, otomatik yeniden çalıştırma

**Files:**
- Modify:
  - `src/types/api.ts`: `DocFinderHistoryItem.has_results?: boolean`; `filters.request?: { filters?: BrowseFilters; per_corpus?: number; smart?: boolean; rerank?: boolean }`; `FindDocumentsResponse.history_id?: string | null`; yeni `export interface BelgeBulIstek { filters?: BrowseFilters | null; per_corpus?: number; smart?: boolean; rerank?: boolean }` ve `export interface KayitliSonucResponse { query: string; created_at: string; request: BelgeBulIstek | null; response: Omit<FindDocumentsResponse, 'newBalance'> }`; `DocFinderHistoryItem.filters.request?: BelgeBulIstek`.
  - `src/lib/api/documents.ts`: `getSavedResults(id: string): Promise<KayitliSonucResponse>` → `GET /api/belge-bul/history/:id/results`.
  - `src/stores/documents.ts`
  - `src/views/DocumentHistoryView.vue`
  - `src/views/DocumentFinderView.vue`
- Test:
  - `src/stores/documents.test.ts`
  - `src/views/DocumentHistoryView.flow.test.ts` (yeni)
  - `src/views/DocumentFinderView.flow.test.ts`

**Interfaces:**
- Consumes: S1 sözleşmesi.
- Produces (store):
  - `kayitliTarih: Ref<string | null>`
  - `yukleKayitli(k: KayitliSonucResponse): void`. Yaptıkları:
    - `lastResults = {...k.response, newBalance: <mevcut bakiye ya da 0>}`;
    - `lastQuery = queryText = k.query`;
    - `manualFilters = k.request?.filters ?? blankFilters()`;
    - `resetListState()`;
    - `kayitliTarih = k.created_at`.
  - `bekleyenCalistirma: Ref<{ query: string; filters: BrowseFilters | null } | null>`
  - `search()` başarıyla bitince `kayitliTarih = null` olur.
- **DocumentHistoryView.openSearch(it):**
  - **`it.has_results`:** `getSavedResults(it.id)` çağrılır.
    - Başarılıysa: `documents.yukleKayitli(...)` → `router.push({ name: 'document-finder' })`.
    - 404 ya da hata: aşağıdaki yeniden çalıştırma yoluna düşülür.
  - **Değilse:** `documents.bekleyenCalistirma = { query: it.query, filters: it.filters?.request?.filters ?? null }` → `router.push({ name: 'document-finder' })`. URL'de `?q=` YOK.
  - Satır etiketi: `has_results` ise `KAYITLI`, değilse `2 KR · YENİDEN ÇALIŞIR`.
- **DocumentFinderView:**
  - **`onMounted`:** `bekleyenCalistirma` varsa:
    1. değerini al ve hemen `null` yap (tek kullanımlık);
    2. `queryText` ve `manualFilters`'ı ayarla (`filters` null ise `blankFilters()`);
    3. `currentQuery = query`;
    4. `runSearch()`.
  - **Not:** sonuç başlığının üstünde, `kayitliTarih` doluyken spec metniyle görünür. Tarih `tr-TR`, örn. "10 Kas 2026 19:42".
  - **`YENİDEN ÇALIŞTIR (2 KR)`:** `currentQuery = lastQuery`, filtreler mevcut `manualFilters`, sonra `runSearch()`.
  - "Son Aramalar" (`?q=`) bugünkü gibi kalır.

- [ ] **Step 1: Failing tests**
  - Store:
    - `yukleKayitli` lastResults, sorgu, filtreler, `kayitliTarih` alanlarını doldurur; liste durumunu ve seçimi sıfırlar.
    - Başarılı `search()` `kayitliTarih`'i temizler.
  - History flow (memory router, mock api):
    - `has_results` satırı → `getSavedResults` çağrılır, `findDocuments` ÇAĞRILMAZ, Belge Bul'a gidilir, sonuç kartları ve not görünür.
    - Kayıtsız satır → `findDocuments` tam bir kez çağrılır, `request.filters` ile; "FİLTRELİ" rozeti görünür.
    - `has_results` ama `getSavedResults` 404 → yeniden çalıştırma yoluna düşer.
    - Etiket metinleri birebir.
  - Finder flow:
    - otomatik çalıştırmadan sonra geri gidip tekrar gelince `findDocuments` İKİNCİ kez çağrılmaz;
    - `YENİDEN ÇALIŞTIR (2 KR)` `findDocuments`'ı mevcut sorgu ve filtrelerle çağırır;
    - yeni arama sonrası not kalkar.
- [ ] **Step 2:** `npx vitest run src/stores src/views` → FAIL.
- [ ] **Step 3:** Yaz.
- [ ] **Step 4:** `npm test && npm run build` → PASS (290 + yeni).
- [ ] **Step 5:** Commit: `feat(belge-bul): geçmişten kayıtlı sonuçlar kredisiz açılır, süresi dolan yeniden çalışır`.

## Task V: Tablo, uçtan uca, PR'lar

- [ ] **Step 1:** Kullanıcıya migration 020'nin SQL'ini ver. Kullanıcı Supabase SQL editöründe çalıştırır. Sonra REST ile doğrula: `search_results` tablosu var, 0 satır.
- [ ] **Step 2:** Yerel yığını başlat: scratchpad `e2e/yerel-belge-bul.sh`, sunucu ve web klasörlerini `server-gecmis` / `web-gecmis` yap. Portlar boşsa 8200/3200/5280 kullanılır.
- [ ] **Step 3:** Kullanıcı yerel sitede denesin:
  1. bir arama yapar;
  2. Geçmiş'te o satırda `KAYITLI` görünür; tıklayınca sonuçlar kredisiz ve anında gelir (bakiye değişmez), not görünür;
  3. eski (7 günden önce) bir satır `2 KR · YENİDEN ÇALIŞIR`; tıklayınca arama çalışır, GERİ ile dönünce tekrar çalışmaz.

  Ayrıca REST ile `search_results`'ta yeni satırın boyutunu ölç (`octet_length(response::text)`) ve PR'a yaz.
- [ ] **Step 4:** Kullanıcı onayıyla push + PR'lar (sunucu → main, web → main). Açıklamaya migration'ın canlıda uygulandığını, deploy sırasını (migration ✓ → sunucu → web) ve kapatma anahtarını (`BELGE_BUL_SONUC_SAKLAMA_GUN=0`) yaz.
- [ ] **Step 5:** Hafıza: `belge-bul-gecmis-sonuc-saklama.md` (PR numaraları, durum), `acik-tasklar.md`.

---

## Plan incelemesi sonrası (BAĞLAYICI — yukarıdakiyle çelişirse bu geçerli)

**Sunucu (S1)**
- **M3 fail-open her yerde.**
  - `kayitliSonucIdleri` ve `kayitliSonuc` `{error}` aldığında uyarı yazar ve `new Set()` / `null` döner; tablo yoksa Geçmiş listesi asla 500 vermez.
  - `ids` boşsa sorgu atılmaz.
  - `has_results` id'leri `limit+1` satırdan değil, dilimlenmiş öğelerden hesaplanır.
  - PostgREST gömülü ilişki (embed) KULLANILMAZ; tablo yokken listeyi kırar.
  - Testler: üç yardımcıda `{error:{code:'PGRST205'}}`.
- **M4 istek yolu.**
  - Sıra: `search_history` insert (`history_id` için) → `res.json(...)` → `void sonucuKaydet(...)`. Kayıt yanıttan SONRA yapılır ve her hatayı yutar.
  - Boyut sınırı: `JSON.stringify(response).length > 2_000_000` ise kaydetme, uyarı yaz. Başarıda bayt sayısını günlüğe yaz.
  - Toplu DELETE için kısma: modül düzeyinde "son temizlik" zamanı tutulur; örnek başına en çok 5 dakikada bir çalışır.
  - Supabase çağrılarına `.abortSignal(AbortSignal.timeout(5000))`.
  - Testler kaydı `vi.waitFor` ile bekler.
- **M5 sözleşme.**
  - `search_results.request` = `{query, filters, per_corpus, smart, rerank}` (sorgu dahil); `/results` yanıtındaki `query` buradan gelir.
  - `search_history.filters.request` = `{filters, per_corpus, smart, rerank}` (sorgusuz).
  - Okuma: `.eq('history_id', id).eq('user_id', userId).gte('created_at', esik).maybeSingle()`.
  - Geçersiz id: `z.string().uuid().safeParse` başarısızsa `NotFoundError` (404), 400 değil.
- **m1 kapatma anahtarı.**
  - Env `z.preprocess(v => v === '' ? undefined : v, z.coerce.number().int().nonnegative().default(7))`.
  - Süre `saklamaGun()` ile fonksiyon içinde okunur, modül yüklenirken değil.
  - Değer `0` iken kayıt yapılmaz; temizlik eşiği `now` olur ve tablo boşalır.
  - `.env.example`'a eklenir.
- **m9:** migration 020 politikası 005'teki gibi `DROP POLICY IF EXISTS …; CREATE POLICY …` (tekrar uygulanabilir).
- **Test:** `tests/find-documents-history.test.ts`'in sahte supabase'i yeniden yazılır: tabloya duyarlı, zincirlenebilir, thenable; `from(table)`, `select` argümanı, `.eq/.in/.gte/.lt` ve insert payload'ı kaydedilir.
  - Kayıt testlerinde en az 1 belgelik fixture kullanılır.
  - Sahte saat yalnız `Date` için: `vi.useFakeTimers({ toFake: ['Date'] })` ya da `vi.setSystemTime`.

**Web (W1)**
- **M1 kredi güvenliği.** `getSavedResults` YALNIZ `err.status === 404` ise yeniden çalıştırma yoluna düşer ve `toast.info('Kaydın süresi dolmuş; yeniden çalıştırılıyor (2 KR)')` gösterir. Başka her hatada `toast.error('Kayıtlı sonuç şu an açılamadı')` çıkar ve sayfa Geçmiş'te kalır. Test: 500 → `findDocuments` çağrılmaz.
- **M2 eski sunucu.**
  - `has_results === undefined` → eski davranış: `router.push({name:'document-finder', query:{q}})` (kutuya yazar, çalıştırmaz) ve etiket gösterilmez.
  - YALNIZ `has_results === false` otomatik çalıştırır.
  - Test: `undefined` → `findDocuments` çağrılmaz.
- **M6 bakiye.**
  - `lastResults` tipi `Ref<Omit<FindDocumentsResponse,'newBalance'> | null>`.
  - `yukleKayitli` `k.response`'u olduğu gibi koyar; sahte bakiye yazılmaz, `user.setCredits` ÇAĞRILMAZ.
  - Test: bakiye değişmez.
- **m2 tek kullanımlık bayrak.**
  - Bayrak `{ query, filters, ts }` taşır; mount'ta `Date.now() - ts > 30_000` ise yok sayılır.
  - History'de `const f = await router.push(...)`; `isNavigationFailure(f)` ise bayrak temizlenir.
  - Çıkışta (`UserMenu` logout) `documents.clear()` çağrılır. `clear()`, `kayitliTarih` ve `bekleyenCalistirma`'yı da sıfırlar.
- **m3:** `yukleKayitli`, `bekleyenCalistirma`'yı `null` yapar.
- **m4:** filtreler `{...blankFilters(), ...k.request?.filters}` ile birleştirilir.
- **m5:** YENİDEN ÇALIŞTIR, kayıtlı isteğin filtreleriyle çalışır; store'da `kayitliIstek` anlık görüntüsü tutulur.
- **m6:** `openSearch` sırasında satır başına `opening` koruması ve küçük bir yükleniyor göstergesi.
- **m7 metinler.**
  - Not metni (birebir, virgüllü): `Bu sonuçlar {gg Ay yyyy, ss:dd} tarihli aramanın kayıtlı halidir.`
  - DocumentHistoryView'daki "tıkla, kutuya dolsun, tekrar ara" ipucu ve dosya başı yorumu yeni davranışa göre güncellenir.
  - Tarih testleri TZ'den bağımsız olur (regex ya da sabit TZ).
- **m8:** `DocFinderHistoryItem.filters.request` tek tanım: `BelgeBulIstek`.
- **m10:** Co-Authored-By satırı uygulayan modelin satırıdır.

**Teslim (V)**
- PR açıklamasına `BELGE_BUL_SONUC_SAKLAMA_GUN` ve geri alma adımları yazılır: env 0 → sunucu revert → `DROP TABLE`.
- Yerel denemenin oluşturduğu kayıtlar canlı tabloda 7 gün durur; kabul edildi.
