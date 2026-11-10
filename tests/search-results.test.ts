// Belge Bul kayıtlı sonuçlar: search_results tablosuna yazma / okuma / temizlik yardımcıları.
// Gerçek fonksiyonlar, tabloya duyarlı sahte supabase (tests/helpers/fakeSupabase.ts). Saat yalnız Date için sahte.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock('../src/config/logger.js', () => ({ logger: log }));
vi.mock('../src/config/supabase.js', async () => {
  const { fakeSupabase } = await import('./helpers/fakeSupabase.js');
  return { supabaseAdmin: fakeSupabase };
});

import type { BrainBrowseDocumentsResponse } from '../src/brain/brain.types.js';
import { env } from '../src/config/env.js';
import {
  kayitliSonuc,
  kayitliSonucIdleri,
  sonucKaydedilmeli,
  sonucuKaydet,
} from '../src/modules/documents/searchResults.js';
import { fakeSupabase as fake } from './helpers/fakeSupabase.js';

const GUN = 24 * 60 * 60 * 1000;
const DK = 60 * 1000;
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const U1 = 'user-1';
const U2 = 'user-2';
const H1 = '00000000-0000-4000-8000-0000000000a1';
const H2 = '00000000-0000-4000-8000-0000000000a2';
const H3 = '00000000-0000-4000-8000-0000000000a3';

const iso = (ms: number) => new Date(ms).toISOString();

function yanit(over: Partial<Record<string, unknown>> = {}): BrainBrowseDocumentsResponse {
  return {
    documents: [{ chunk_id: 'c1', law_id: 'KVK', law_name: 'KVK', excerpt: 'x' }],
    total_found: 1,
    per_corpus_counts: { kanun: 1 },
    search_time_ms: 5,
    applied: { smart: true },
    cost: { total_usd: 0 },
    kaynak_envanteri: {
      gruplar: [
        {
          grup: 'duzenleme',
          etiket: 'Düzenleme',
          korpuslar: [{ korpus: 'kanun', etiket: 'Kanun', sayi: 1, durum: 'bulundu' }],
        },
      ],
    },
    ...over,
  } as unknown as BrainBrowseDocumentsResponse;
}

const envanter = (durum: string) => ({
  gruplar: [
    {
      grup: 'duzenleme',
      etiket: 'Düzenleme',
      korpuslar: [
        { korpus: 'kanun', etiket: 'Kanun', sayi: 1, durum: 'bulundu' },
        { korpus: 'teblig', etiket: 'Tebliğ', sayi: 0, durum },
      ],
    },
  ],
});

let testNo = 0;
const kayitSaklama = env.BELGE_BUL_SONUC_SAKLAMA_GUN;

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  env.BELGE_BUL_SONUC_SAKLAMA_GUN = 7;
  // Her test, modül düzeyindeki temizlik kısmasının (5 dk) dışına düşsün diye saati ileri alır.
  testNo += 1;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0 + testNo * 60 * DK);
});

afterEach(() => {
  vi.useRealTimers();
  env.BELGE_BUL_SONUC_SAKLAMA_GUN = kayitSaklama;
});

describe('sonucKaydedilmeli', () => {
  it('0 belge → false', () => {
    expect(sonucKaydedilmeli(yanit({ documents: [] }))).toBe(false);
  });

  it('hata durumlu bir korpus varsa → false', () => {
    expect(sonucKaydedilmeli(yanit({ kaynak_envanteri: envanter('hata') }))).toBe(false);
  });

  it('normal yanıt → true', () => {
    expect(sonucKaydedilmeli(yanit())).toBe(true);
  });

  it('sonuç_yok / kapalı korpus hata değildir → true', () => {
    expect(sonucKaydedilmeli(yanit({ kaynak_envanteri: envanter('sonuc_yok') }))).toBe(true);
    expect(sonucKaydedilmeli(yanit({ kaynak_envanteri: envanter('kapali') }))).toBe(true);
  });

  it('künye modu (kaynak_envanteri null, belge var) → true', () => {
    expect(sonucKaydedilmeli(yanit({ kaynak_envanteri: null }))).toBe(true);
    expect(sonucKaydedilmeli(yanit({ kaynak_envanteri: undefined }))).toBe(true);
  });
});

describe('sonucuKaydet', () => {
  const istek = { query: 'kdv iadesi', filters: { daire: '3. Daire' }, per_corpus: 50, smart: true, rerank: true };

  it('doğru tabloya {history_id, user_id, request, response} ekler', async () => {
    const response = yanit();
    await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response });

    const eklemeler = fake.callsFor('search_results', 'insert');
    expect(eklemeler).toHaveLength(1);
    expect(eklemeler[0]!.payload).toEqual({ history_id: H1, user_id: U1, request: istek, response });
  });

  it('eşik now - 7 gün ile TÜM kullanıcıların süresi dolmuş satırlarını siler, tazeleri bırakır', async () => {
    const now = Date.now();
    fake.seed('search_results', [
      { id: 'eski-u1', history_id: 'x1', user_id: U1, created_at: iso(now - 8 * GUN) },
      { id: 'eski-u2', history_id: 'x2', user_id: U2, created_at: iso(now - 30 * GUN) },
      { id: 'taze-u2', history_id: 'x3', user_id: U2, created_at: iso(now - 6 * GUN) },
    ]);

    await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() });

    const silmeler = fake.callsFor('search_results', 'delete');
    expect(silmeler).toHaveLength(1);
    // Yalnız created_at < eşik; kullanıcı süzgeci YOK (tüm kullanıcılar).
    expect(silmeler[0]!.filters).toEqual([{ op: 'lt', column: 'created_at', value: iso(now - 7 * GUN) }]);
    expect(fake.rows('search_results').map((r) => r.id)).toEqual(['taze-u2', expect.any(String)]);
  });

  it('saklama günü env değerinden, çağrı anında okunur', async () => {
    env.BELGE_BUL_SONUC_SAKLAMA_GUN = 14;
    await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() });
    expect(fake.callsFor('search_results', 'delete')[0]!.filters).toEqual([
      { op: 'lt', column: 'created_at', value: iso(Date.now() - 14 * GUN) },
    ]);
  });

  it('insert hata döndürürse fırlatmaz, uyarı yazar', async () => {
    fake.failOn('search_results', 'insert', { code: '23505', message: 'boom' });
    await expect(
      sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() })
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });

  it('tablo yokken (PGRST205) insert ve delete de fırlatmaz', async () => {
    fake.failOn('search_results', 'insert', { code: 'PGRST205' });
    fake.failOn('search_results', 'delete', { code: 'PGRST205' });
    await expect(
      sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() })
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });

  it('supabase çağrısı reddedilse bile (ağ hatası) fırlatmaz', async () => {
    fake.failOn('search_results', 'insert', new Error('fetch failed'));
    fake.failOn('search_results', 'delete', new Error('fetch failed'));
    await expect(
      sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() })
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });

  it('insert başarısız olsa da süresi dolmuş satırlar temizlenir', async () => {
    fake.seed('search_results', [
      { id: 'eski', history_id: 'x1', user_id: U2, created_at: iso(Date.now() - 9 * GUN) },
    ]);
    fake.failOn('search_results', 'insert', { code: 'PGRST205' });
    await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() });
    expect(fake.rows('search_results')).toHaveLength(0);
  });

  it('her supabase çağrısı 5 sn AbortSignal ile sınırlanır', async () => {
    await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() });
    const cagrilar = fake.callsFor('search_results');
    expect(cagrilar.length).toBeGreaterThanOrEqual(2); // insert + delete
    for (const c of cagrilar) expect(c.signal).toBeInstanceOf(AbortSignal);
  });

  it('toplu silme en çok 5 dakikada bir çalışır (örnek başına)', async () => {
    await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() });
    expect(fake.callsFor('search_results', 'delete')).toHaveLength(1);

    vi.setSystemTime(Date.now() + 4 * DK);
    await sonucuKaydet({ historyId: H2, userId: U1, request: istek, response: yanit() });
    expect(fake.callsFor('search_results', 'insert')).toHaveLength(2); // kayıt yine yazılır
    expect(fake.callsFor('search_results', 'delete')).toHaveLength(1); // temizlik kısıldı

    vi.setSystemTime(Date.now() + 2 * DK); // ilk silmeden 6 dk sonra
    await sonucuKaydet({ historyId: H3, userId: U1, request: istek, response: yanit() });
    expect(fake.callsFor('search_results', 'delete')).toHaveLength(2);
  });

  it('başarısız silme de kısma penceresini tüketir (her istekte yeniden denenmez)', async () => {
    fake.failOn('search_results', 'delete', { code: 'PGRST205' });
    await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() });
    await sonucuKaydet({ historyId: H2, userId: U1, request: istek, response: yanit() });
    expect(fake.callsFor('search_results', 'delete')).toHaveLength(1);
  });

  it('yanıt 2.000.000 karakteri aşarsa kaydetmez ve uyarı yazar', async () => {
    const dev = yanit({ documents: [{ chunk_id: 'c1', excerpt: 'a'.repeat(2_000_001) }] });
    await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: dev });
    expect(fake.callsFor('search_results', 'insert')).toHaveLength(0);
    expect(log.warn).toHaveBeenCalled();
  });

  it('başarıda kaydedilen bayt sayısını günlüğe yazar', async () => {
    const response = yanit({ documents: [{ chunk_id: 'c1', excerpt: 'şğü' }] });
    await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response });
    const bayt = Buffer.byteLength(JSON.stringify(response));
    expect(log.info).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ bytes: bayt }));
  });

  describe('saklama 0 (kapatma anahtarı)', () => {
    beforeEach(() => {
      env.BELGE_BUL_SONUC_SAKLAMA_GUN = 0;
    });

    it('hiçbir kayıt eklemez', async () => {
      await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() });
      expect(fake.callsFor('search_results', 'insert')).toHaveLength(0);
      expect(fake.rows('search_results')).toHaveLength(0);
    });

    it('temizlik eşiği now olur ve tablo boşalır', async () => {
      fake.seed('search_results', [
        { id: 'taze', history_id: 'x1', user_id: U2, created_at: iso(Date.now() - 1 * DK) },
        { id: 'eski', history_id: 'x2', user_id: U1, created_at: iso(Date.now() - 3 * GUN) },
      ]);
      await sonucuKaydet({ historyId: H1, userId: U1, request: istek, response: yanit() });
      const silmeler = fake.callsFor('search_results', 'delete');
      expect(silmeler).toHaveLength(1);
      expect(silmeler[0]!.filters).toEqual([{ op: 'lt', column: 'created_at', value: iso(Date.now()) }]);
      expect(fake.rows('search_results')).toHaveLength(0);
    });

    it('okumalar supabase\'e hiç gitmez: boş küme / null', async () => {
      fake.seed('search_results', [
        { id: 'r1', history_id: H1, user_id: U1, created_at: iso(Date.now() - 1 * DK), request: {}, response: {} },
      ]);
      expect(await kayitliSonuc(H1, U1)).toBeNull();
      expect((await kayitliSonucIdleri([H1], U1)).size).toBe(0);
      expect(fake.callsFor('search_results')).toHaveLength(0);
    });
  });
});

describe('kayitliSonuc', () => {
  const request = { query: 'kdv', filters: null, per_corpus: 50, smart: true, rerank: true };
  const response = { documents: [{ chunk_id: 'c1' }] };

  it('sahibine ve süresi içindeyse {created_at, request, response} döner', async () => {
    const created = iso(Date.now() - 2 * GUN);
    fake.seed('search_results', [{ id: 'r1', history_id: H1, user_id: U1, created_at: created, request, response }]);

    expect(await kayitliSonuc(H1, U1)).toEqual({ created_at: created, request, response });
  });

  it('sorgu: history_id + user_id eşitliği, created_at >= now - 7 gün, maybeSingle, 5 sn sınır', async () => {
    await kayitliSonuc(H1, U1);
    const [c] = fake.callsFor('search_results', 'select');
    expect(c!.filters).toEqual([
      { op: 'eq', column: 'history_id', value: H1 },
      { op: 'eq', column: 'user_id', value: U1 },
      { op: 'gte', column: 'created_at', value: iso(Date.now() - 7 * GUN) },
    ]);
    expect(c!.single).toBe('maybeSingle');
    expect(c!.signal).toBeInstanceOf(AbortSignal);
  });

  it('başka kullanıcının kaydı → null', async () => {
    fake.seed('search_results', [
      { id: 'r1', history_id: H1, user_id: U2, created_at: iso(Date.now() - 1 * GUN), request, response },
    ]);
    expect(await kayitliSonuc(H1, U1)).toBeNull();
  });

  it('8 günlük kayıt → null', async () => {
    fake.seed('search_results', [
      { id: 'r1', history_id: H1, user_id: U1, created_at: iso(Date.now() - 8 * GUN), request, response },
    ]);
    expect(await kayitliSonuc(H1, U1)).toBeNull();
  });

  it('kayıt yok → null', async () => {
    expect(await kayitliSonuc(H1, U1)).toBeNull();
  });

  it('tablo yokken (PGRST205) null döner ve uyarı yazar', async () => {
    fake.failOn('search_results', 'select', { code: 'PGRST205' });
    expect(await kayitliSonuc(H1, U1)).toBeNull();
    expect(log.warn).toHaveBeenCalled();
  });

  it('supabase çağrısı reddedilirse null döner', async () => {
    fake.failOn('search_results', 'select', new Error('fetch failed'));
    expect(await kayitliSonuc(H1, U1)).toBeNull();
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('kayitliSonucIdleri', () => {
  it('yalnız taze olan, bu kullanıcıya ait olanların id\'lerini döner', async () => {
    const now = Date.now();
    fake.seed('search_results', [
      { id: 'r1', history_id: H1, user_id: U1, created_at: iso(now - 1 * GUN) },
      { id: 'r2', history_id: H2, user_id: U1, created_at: iso(now - 8 * GUN) }, // süresi dolmuş
      { id: 'r3', history_id: H3, user_id: U2, created_at: iso(now - 1 * GUN) }, // başkasının
    ]);

    const idler = await kayitliSonucIdleri([H1, H2, H3], U1);
    expect([...idler]).toEqual([H1]);
  });

  it('yalnız history_id ve created_at seçer; response sütununu SEÇMEZ', async () => {
    await kayitliSonucIdleri([H1], U1);
    const [c] = fake.callsFor('search_results', 'select');
    expect(c!.columns).toBe('history_id, created_at');
    expect(c!.columns).not.toContain('response');
    expect(c!.columns).not.toContain('*');
    expect(c!.filters).toEqual([
      { op: 'eq', column: 'user_id', value: U1 },
      { op: 'in', column: 'history_id', value: [H1] },
      { op: 'gte', column: 'created_at', value: iso(Date.now() - 7 * GUN) },
    ]);
    expect(c!.signal).toBeInstanceOf(AbortSignal);
  });

  it('id listesi boşsa sorgu atılmaz', async () => {
    const idler = await kayitliSonucIdleri([], U1);
    expect(idler.size).toBe(0);
    expect(fake.callsFor('search_results')).toHaveLength(0);
  });

  it('tablo yokken (PGRST205) boş küme döner ve uyarı yazar; 500 vermez', async () => {
    fake.failOn('search_results', 'select', { code: 'PGRST205' });
    const idler = await kayitliSonucIdleri([H1], U1);
    expect(idler.size).toBe(0);
    expect(log.warn).toHaveBeenCalled();
  });

  it('supabase çağrısı reddedilirse boş küme döner', async () => {
    fake.failOn('search_results', 'select', new Error('fetch failed'));
    const idler = await kayitliSonucIdleri([H1], U1);
    expect(idler.size).toBe(0);
  });
});

describe('BELGE_BUL_SONUC_SAKLAMA_GUN (env)', () => {
  const eski = process.env.BELGE_BUL_SONUC_SAKLAMA_GUN;

  async function yukle(deger: string | undefined) {
    if (deger === undefined) delete process.env.BELGE_BUL_SONUC_SAKLAMA_GUN;
    else process.env.BELGE_BUL_SONUC_SAKLAMA_GUN = deger;
    vi.resetModules();
    const m = await import('../src/config/env.js');
    return m.env.BELGE_BUL_SONUC_SAKLAMA_GUN;
  }

  afterEach(() => {
    if (eski === undefined) delete process.env.BELGE_BUL_SONUC_SAKLAMA_GUN;
    else process.env.BELGE_BUL_SONUC_SAKLAMA_GUN = eski;
  });

  it('tanımsızken 7', async () => {
    expect(await yukle(undefined)).toBe(7);
  });

  it('boş string (Railway\'de boş değişken) 7 sayılır, 0 DEĞİL', async () => {
    expect(await yukle('')).toBe(7);
  });

  it('"0" kapatma anahtarıdır', async () => {
    expect(await yukle('0')).toBe(0);
  });

  it('"14" → 14', async () => {
    expect(await yukle('14')).toBe(14);
  });
});
