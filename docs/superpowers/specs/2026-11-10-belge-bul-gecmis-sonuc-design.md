# Belge Bul Geçmiş — kayıtlı sonuçlar (tasarım)

Tarih: 2026-11-10 · Durum: taslak (kullanıcı onayı bekliyor) · Depolar: vergilex-server (app DB migration + API), vergilex-web

## 1. Niyet

Belge Bul Geçmiş'te geçmiş bir aramaya tıklayan kullanıcı o aramanın **sonuçlarını** görmek istiyor.
Bugün tıklama yalnız sorguyu arama kutusuna yazıyor, aramayı çalıştırmıyor ve sonuçlar hiçbir yerde
saklanmıyor (search_history yalnız sorgu, `applied`, sayaçlar ve sonuç sayısını tutuyor). Kullanıcıya
"yeni soru soruyormuşuz gibi" görünüyor. Ekranda bir önceki aramanın sonuçları kalmışsa, kutudaki yeni
sorguyla altındaki eski sonuçlar birbirini tutmuyor.

Başarı:
- **Son 7 gün içindeki** bir aramaya tıklanınca o aramanın sonuçları o günkü haliyle, **anında ve kredisiz**
  açılır. Kullanıcı bunları yeni aramadaki gibi gezebilir, açabilir, seçebilir ve dışa aktarabilir.
- **7 günden eski** (ya da kayıtlı sonucu olmayan) bir aramaya tıklanınca arama **o an sorulmuş gibi**
  yeniden çalışır ve güncel sonuçlar gelir. Normal arama gibi 2 KR düşer.

## 2. Kararlar (kullanıcı)

- Saklama süresi **şimdilik 1 hafta (7 gün)**. İleride artırılabilir ya da premium yapılabilir; bu karar
  kullanıcıda ve hafızada kayıtlı. Süre **tek bir ayarda** durur (sunucu env:
  `BELGE_BUL_SONUC_SAKLAMA_GUN`, varsayılan 7).
- Süresi dolmuş ya da sonucu olmayan arama = yeniden çalıştırma (o an sorulmuş gibi, 2 KR).
- Kayıtlı sonuçlar açılınca küçük bir not gösterilir: "Bu sonuçlar {gg Ay yyyy, ss:dd} tarihli aramanın
  kayıtlı halidir". Yanında **YENİDEN ÇALIŞTIR (2 KR)** düğmesi olur (kullanıcı playback'te onayladı).

## 3. Tasarım

**Veri (app DB, yeni migration `020_search_results.sql`).** Yeni tablo `public.search_results`:
- Sütunlar:
  - `id uuid pk default gen_random_uuid()`
  - `history_id uuid NOT NULL UNIQUE REFERENCES public.search_history(id) ON DELETE CASCADE`
  - `user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE`
  - `request jsonb` (kullanıcının gönderdiği `{query, filters, per_corpus, smart, rerank}`)
  - `response jsonb NOT NULL` (beynin döndürdüğü tam yanıt; `newBalance` hariç)
  - `created_at timestamptz NOT NULL default now()`
- İndeks `(user_id, created_at DESC)`.
- RLS açık, yalnız kendi satırını SELECT (005'teki desen). Sunucu service key ile yazar ve okur, her
  sorguda `user_id` süzer.
- Ayrı tablo olmasının sebebi: Geçmiş listesi (`search_history`) hafif kalsın. Liste uç noktası büyük
  JSON'u hiç okumaz.

**Sunucu.**
- `POST /api/belge-bul`: `search_history` satırı artık `id` ile döndürülür (`.select('id').single()`).
  Ardından `search_results` eklenir. Bu adım **ölümcül değildir**: hata olursa günlüğe yazılır, istemci
  yanıtı etkilenmez (tablo yokken de çalışır; deploy sırası kırılgan olmaz). Yanıta `history_id`
  eklenir.
- Tembel temizlik: aynı istekte, aynı kullanıcının `created_at < now() - saklama` olan
  `search_results` satırları silinir (ucuz, indeksli). Okuma tarafı da süreyi ayrıca denetler.
- `GET /api/belge-bul/history` öğelerine `has_results: boolean` eklenir (satır var ve süre dolmamış).
  Liste sorgusu bunu ikinci küçük bir sorguyla ya da gömülü ilişkiyle yalnız id ve created_at okuyarak
  bulur, `response`'u okumaz.
- Yeni `GET /api/belge-bul/history/:id/results`: kullanıcıya ait ve süresi dolmamışsa
  `{ query, created_at, request, response }` döner, değilse 404. Kredi düşmez. `aiLimiter`'a girmez,
  genel sınır yeterli.

**Web.**
- **Geçmiş satırına tıklama:**
  - `has_results` ise: kayıtlı yanıt çekilir ve documents store'a "kayıtlı arama" olarak yüklenir.
    `lastResults` ile `lastQuery` dolar; liste durumu yeni aramadaki gibi sıfırlanır. `queryText`
    sorguya ayarlanır, `/belge-bul` açılır.
  - Değilse: `/belge-bul`'a gidilir ve arama o sorguyla **hemen çalıştırılır**. Kayıtlı `request`
    yoksa yalnız sorgu kullanılır. Normal arama akışından geçer (kredi, toast, geçmişe yeni satır).
- **Belge Bul sayfası:** kayıtlı sonuç gösterilirken üstte not ve YENİDEN ÇALIŞTIR (2 KR) düğmesi
  durur. Düğme aynı sorgu ve isteğin filtreleriyle normal aramayı çalıştırır. Yeni bir arama yapılınca
  not kalkar.
- **Geçmiş listesi:** her satırda küçük bir etiket olur. `has_results` ise "KAYITLI", değilse
  "2 KR · YENİDEN ÇALIŞIR" (benim kararım; kullanıcı tıklamadan ne olacağını görür).
- Önceki işin özellikleri (tebliğ kutusu, sabit kart, seçim, dışa aktarma, geri dönüş) kayıtlı
  sonuçlarda da aynen çalışır, çünkü aynı yanıt nesnesi kullanılır.

## 4. Hedef olmayanlar

- Belge Bul sayfasındaki boş durum "Son Aramalar" listesi bugünkü gibi kalır (kutuya yazar). Bu işin
  konusu Geçmiş sayfası (benim kararım).
- Sohbet ya da Üç Aşamalı geçmişi.
- 7 günden uzun saklama ve premium. İkisi de sonraki karar.
- Beyin (api) değişikliği yok.

## 5. Kısıtlar

- Dal ve PR akışı: sunucu ve web PR'ı `main`'e gider; web'i yalnız Atilla merge eder.
- Migration'ı app DB'ye kullanıcı uygular, ya da kullanıcının izniyle ben uygularım. Sunucu tablo
  yokken de çalışır (fail-open).
- Deploy sırası: migration → sunucu → web. Web, `has_results` gelmezse eski davranışa döner: sorguyu
  kutuya yazar.
- KVKK: saklanan içerik herkese açık mevzuat ve karar metinleri. Sorgu metni zaten bugün
  `search_history`'de tutuluyor.
- Boyut: bir yanıt kabaca 100–600 KB. Postgres TOAST JSONB'yi sıkıştırır. Bugünkü kullanım
  (~12 arama/gün) ve 7 günlük saklamayla toplam on MB'lar mertebesinde. Geliştirici gerçek bir yanıtın
  boyutunu ölçüp PR'a yazar.
- Testler gerçek fonksiyonlar üzerinde. Uçtan uca deneme yerel yığınla yapılır.

## 6. Geliştiriciye bırakılanlar

- `has_results`'ın nasıl hesaplanacağı (ikinci sorgu ya da gömülü ilişki).
- Store'daki "kayıtlı arama" alanının adı ve biçimi.
- Etiket ve not metinlerinin küçük ayrıntıları (Türkçe, sade).
- Temizliğin tam yeri.

## 7. Builder check sonrası kararlar (Claude'un kararları)

- **Yeniden çalıştırmanın filtreleri.** Kullanıcının o aramada gönderdiği istek (`{filters, per_corpus,
  smart, rerank}`) artık `search_history.filters.request` içine de yazılır. Bu küçük bir JSON; sütun zaten
  jsonb olduğu için migration gerekmez ve satır kalıcıdır.
  - Süresi dolmuş satır yeniden çalıştırılınca bu filtreler kullanılır: web `manualFilters`'ı bunlarla
    doldurur, "FİLTRELİ" rozeti de görünür.
  - `request` olmayan eski satırlarda yalnız sorgu kullanılır ve `manualFilters` sıfırlanır; oturumdan
    kalan filtreler sızmaz.
  - YENİDEN ÇALIŞTIR düğmesi de kayıtlı isteğin filtreleriyle çalışır.
  - `GET /history/:id/results` süresi dolmuş satırda 404 döner. Web bu durumda süresi dolmuş satır gibi
    davranır: yeniden çalıştırır.
- **Temizlik.** Her yeni kayıtta saklama süresini aşmış satırların TÜMÜ silinir, tüm kullanıcılar için
  (`created_at` indeksli). Okuma tarafı da süreyi denetler. Böylece Belge Bul'u kullanan herhangi biri
  oldukça kayıtlar süreden fazla kalmaz. pg_cron kullanılmaz.
  - "1 hafta" bir özellik sınırıdır, KVKK taahhüdü değildir. İçerik herkese açık mevzuattır; sorgu metni
    zaten `search_history`'de süresiz tutuluyor.
- **Bozuk ya da boş yanıt saklanmaz.** Sonuç sayısı 0 ise, ya da `kaynak_envanteri`'nde `durum: "hata"`
  olan bir korpus varsa, sonuç kaydedilmez. O aramaya tıklanınca yeniden çalışır.
- **Tekrar ücret alınmaz.** Otomatik çalıştırma tetikleyicisi (ör. sorgu parametresi) çalıştıktan sonra
  URL'den temizlenir. Geri tuşuyla dönünce arama yeniden çalışmaz.
- **Liste ile kayıt arasında yarış.** Liste "KAYITLI" demiş ama kayıt bu arada silinmişse (`/results` →
  404), arama yeniden çalıştırılır.
- **Saklama ayarı.** `BELGE_BUL_SONUC_SAKLAMA_GUN=0` sonuç saklamayı tamamen kapatır (kapatma anahtarı).
