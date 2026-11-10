// Belge Bul: POST find-documents (geçmiş yazımı, kayıtlı sonuç, history_id), GET history (has_results),
// GET history/:id/results (kayıtlı yanıt). Gerçek controller'lar; tabloya duyarlı sahte supabase.
// Geçmiş satırına tebliğ kutusunun yalnız özeti yazılır, HTTP yanıtı TAM kalır.
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  browseDocuments: vi.fn(),
  deductCredits: vi.fn(),
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/brain/brain.client.js', () => ({ brainClient: { browseDocuments: mocks.browseDocuments } }));
vi.mock('../src/modules/credits/credits.service.js', () => ({ deductCredits: mocks.deductCredits }));
vi.mock('../src/config/logger.js', () => ({ logger: mocks.log }));
vi.mock('../src/config/supabase.js', async () => {
  const { fakeSupabase } = await import('./helpers/fakeSupabase.js');
  return { supabaseAdmin: fakeSupabase };
});

import { env } from '../src/config/env.js';
import {
  findDocuments,
  getDocumentHistory,
  getSavedResults,
} from '../src/modules/documents/documents.controller.js';
import { documentsRouter } from '../src/modules/documents/documents.routes.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { fakeSupabase as fake } from './helpers/fakeSupabase.js';

const GUN = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

let currentUser = 'u1';
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { user: unknown }).user = { id: currentUser, role: 'user' };
  next();
});
app.post('/api/documents/find', findDocuments);
app.get('/api/documents/history', getDocumentHistory);
app.get('/api/documents/history/:id/results', getSavedResults);
app.use(errorHandler);

const etkilenen = Array.from({ length: 200 }, (_, i) => ({
  chunk_id: `c${i}`,
  document_id: 'TEBL-1',
  etiket: `Bölüm ${i}`,
}));

const belge = {
  chunk_id: 'k1',
  law_id: 'KVK',
  law_name: 'Kurumlar Vergisi Kanunu',
  madde_no: '13',
  madde_basligi: 'Örtülü sermaye',
  excerpt: 'Örtülü sermaye ...',
  relevance_score: 0.9,
  source_type: 'law',
  law_references: [],
};

const envanter = (durum: string) => ({
  gruplar: [
    {
      grup: 'duzenleme',
      etiket: 'Düzenleme',
      korpuslar: [{ korpus: 'kanun', etiket: 'Kanun', sayi: 1, durum }],
    },
  ],
});

function beyinYaniti(over: Record<string, unknown> = {}) {
  return {
    documents: [belge],
    total_found: 1,
    per_corpus_counts: { kanun: 1 },
    search_time_ms: 5,
    applied: {
      smart: true,
      reranked: true,
      semantic_query: 'kdv',
      keywords: [],
      exclude_mulga: true,
      kunye_mode: false,
      kunye_bulunan: [],
      kunye_bulunamayan: [],
      teblig_kimlik: {
        aranan: 'KDV GUT',
        durum: 'ana_metne_islenmis',
        not_metni: 'Ana metne işlenmiştir.',
        sabit_id: 'TEBL-1',
        liste: [{ id: 'TEBL-1', adi: 'KDV GUT', rg_tarihi: '2014-01-01' }],
        etkilenen,
        etkilenen_toplam: 412,
        aile_toplam: 9,
      },
    },
    cost: { total_usd: 0 },
    kaynak_envanteri: envanter('bulundu'),
    ...over,
  };
}

// Kayıt yanıttan SONRA, arka planda yazılır: testler `vi.waitFor` ile bekler.
const kayitBekle = (n = 1) => vi.waitFor(() => expect(fake.rows('search_results')).toHaveLength(n));
// "Hiç yazılmaz" iddiası için: arka plan işinin başlayıp bitmesine yetecek kısa bir bekleme (yalnız Date sahte).
const biraz = () => new Promise((r) => setTimeout(r, 40));

let testNo = 0;
const kayitSaklama = env.BELGE_BUL_SONUC_SAKLAMA_GUN;

beforeEach(() => {
  fake.reset();
  vi.clearAllMocks();
  currentUser = 'u1';
  env.BELGE_BUL_SONUC_SAKLAMA_GUN = 7;
  testNo += 1;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0 + testNo * 60 * 60 * 1000); // temizlik kısmasının (5 dk) dışında
  mocks.deductCredits.mockResolvedValue({ newBalance: 42 });
  mocks.browseDocuments.mockResolvedValue(beyinYaniti({ documents: [], total_found: 0 }));
});

afterEach(() => {
  vi.useRealTimers();
  env.BELGE_BUL_SONUC_SAKLAMA_GUN = kayitSaklama;
});

describe('findDocuments history write', () => {
  it('stores the trimmed teblig_kimlik but responds with the full box', async () => {
    const res = await request(app).post('/api/documents/find').send({ query: 'kdv gut seri no 1' });
    expect(res.status).toBe(200);

    // Yanıt: tam kutu + newBalance
    expect(res.body.newBalance).toBe(42);
    expect(res.body.applied.teblig_kimlik.etkilenen).toHaveLength(200);
    expect(res.body.applied.teblig_kimlik.not_metni).toBe('Ana metne işlenmiştir.');
    expect(res.body.applied.teblig_kimlik.liste).toHaveLength(1);

    // Geçmiş: yalnız özet
    const eklemeler = fake.callsFor('search_history', 'insert');
    expect(eklemeler).toHaveLength(1);
    const row = eklemeler[0]!.payload as { filters: Record<string, unknown> & { applied: Record<string, unknown> } };
    expect(row.filters.applied.teblig_kimlik).toEqual({
      aranan: 'KDV GUT',
      durum: 'ana_metne_islenmis',
      sabit_id: 'TEBL-1',
      etkilenen_toplam: 412,
      aile_toplam: 9,
    });
    expect(row.filters.applied.semantic_query).toBe('kdv');
    expect(row.filters.per_corpus_counts).toEqual({ kanun: 1 });
  });
});

describe('findDocuments — history_id ve kayıtlı sonuç', () => {
  const govde = {
    query: 'örtülü sermaye',
    filters: { daire: '3. Daire', exclude_mulga: true },
    per_corpus: 50,
    smart: false,
    rerank: true,
  };

  beforeEach(() => {
    mocks.browseDocuments.mockResolvedValue(beyinYaniti());
  });

  it('geçmiş insert\'inden id alır (select(id).single()) ve yanıt history_id taşır', async () => {
    const res = await request(app).post('/api/documents/find').send(govde);
    expect(res.status).toBe(200);

    const [ekleme] = fake.callsFor('search_history', 'insert');
    expect(ekleme!.columns).toBe('id');
    expect(ekleme!.single).toBe('single');
    // yanıttan ÖNCE çalışan çağrı: 5 sn AbortSignal ile sınırlı (global undici 420 sn)
    expect(ekleme!.signal).toBeInstanceOf(AbortSignal);

    const [satir] = fake.rows('search_history');
    expect(res.body.history_id).toBe(satir!.id);
    expect(res.body.newBalance).toBe(42);
  });

  it('search_history.filters.request = {filters, per_corpus, smart, rerank} (sorgusuz)', async () => {
    await request(app).post('/api/documents/find').send(govde);
    const [satir] = fake.rows('search_history');
    const f = satir!.filters as Record<string, unknown>;
    expect(f.request).toEqual({
      filters: govde.filters,
      per_corpus: 50,
      smart: false,
      rerank: true,
    });
    // mevcut alanlar yerinde
    expect(f.per_corpus_counts).toEqual({ kanun: 1 });
    expect(f.kaynak_envanteri).toEqual(envanter('bulundu'));
  });

  it('search_results satırı yazılır: request sorgu dahil, response = beyin yanıtı (newBalance/history_id yok)', async () => {
    const res = await request(app).post('/api/documents/find').send(govde);
    await kayitBekle();

    const [sonuc] = fake.rows('search_results');
    const [gecmis] = fake.rows('search_history');
    expect(sonuc!.history_id).toBe(gecmis!.id);
    expect(sonuc!.user_id).toBe('u1');
    expect(sonuc!.request).toEqual({
      query: 'örtülü sermaye',
      filters: govde.filters,
      per_corpus: 50,
      smart: false,
      rerank: true,
    });
    expect(sonuc!.response).toEqual(beyinYaniti());
    expect(sonuc!.response).not.toHaveProperty('newBalance');
    expect(sonuc!.response).not.toHaveProperty('history_id');
    expect(res.body.history_id).toBe(gecmis!.id);
  });

  it('kayıt yanıttan SONRA yapılır: search_results yazımı takılı olsa da yanıt 200 gelir', async () => {
    const birak = fake.holdOn('search_results', 'insert');
    const res = await request(app).post('/api/documents/find').send(govde);
    expect(res.status).toBe(200);
    expect(res.body.history_id).toEqual(expect.any(String));
    expect(fake.rows('search_results')).toHaveLength(0); // yanıt döndü, kayıt hâlâ bekliyor
    birak();
    await kayitBekle();
  });

  it('search_results insert\'i patlarsa yanıt yine 200 ve tam', async () => {
    fake.failOn('search_results', 'insert', { code: 'PGRST205', message: 'tablo yok' });
    const res = await request(app).post('/api/documents/find').send(govde);

    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(42);
    expect(res.body.history_id).toEqual(expect.any(String));
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.applied.teblig_kimlik.etkilenen).toHaveLength(200);
    await vi.waitFor(() => expect(fake.callsFor('search_results', 'insert')).toHaveLength(1));
  });

  it('search_results çağrısı reddedilse (ağ hatası) de yanıt 200 ve tam', async () => {
    fake.failOn('search_results', 'insert', new Error('fetch failed'));
    fake.failOn('search_results', 'delete', new Error('fetch failed'));
    const res = await request(app).post('/api/documents/find').send(govde);
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(1);
    await vi.waitFor(() => expect(fake.callsFor('search_results', 'insert')).toHaveLength(1));
  });

  it('boş yanıtta (0 belge) search_results insert\'i yapılmaz', async () => {
    mocks.browseDocuments.mockResolvedValue(beyinYaniti({ documents: [], total_found: 0 }));
    const res = await request(app).post('/api/documents/find').send(govde);
    expect(res.status).toBe(200);
    expect(res.body.history_id).toEqual(expect.any(String)); // geçmiş satırı yine yazılır
    await biraz();
    expect(fake.callsFor('search_results', 'insert')).toHaveLength(0);
  });

  it('hata korpuslu yanıtta search_results insert\'i yapılmaz', async () => {
    mocks.browseDocuments.mockResolvedValue(beyinYaniti({ kaynak_envanteri: envanter('hata') }));
    const res = await request(app).post('/api/documents/find').send(govde);
    expect(res.status).toBe(200);
    await biraz();
    expect(fake.callsFor('search_results', 'insert')).toHaveLength(0);
  });

  it('künye modunda (kaynak_envanteri null, belge var) kayıt yazılır', async () => {
    mocks.browseDocuments.mockResolvedValue(beyinYaniti({ kaynak_envanteri: null }));
    await request(app).post('/api/documents/find').send(govde);
    await kayitBekle();
  });

  it('geçmiş insert\'i hata dönerse history_id null, yanıt 200, uyarı yazılır ve kayıt yazılmaz', async () => {
    fake.failOn('search_history', 'insert', { code: 'PGRST205', message: 'x' });
    const res = await request(app).post('/api/documents/find').send(govde);
    expect(res.status).toBe(200);
    expect(res.body.history_id).toBeNull();
    expect(res.body.documents).toHaveLength(1);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('search_history insert failed'),
      expect.objectContaining({ code: 'PGRST205' })
    );
    await biraz();
    expect(fake.callsFor('search_results', 'insert')).toHaveLength(0);
  });

  it('geçmiş insert\'i reddedilirse (5 sn zaman aşımı) history_id null, yanıt 200 ve uyarı yazılır', async () => {
    fake.failOn(
      'search_history',
      'insert',
      new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    );
    const res = await request(app).post('/api/documents/find').send(govde);
    expect(res.status).toBe(200);
    expect(res.body.history_id).toBeNull();
    expect(res.body.newBalance).toBe(42);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('search_history insert threw'),
      expect.any(Object)
    );
    await biraz();
    expect(fake.callsFor('search_results', 'insert')).toHaveLength(0);
  });

  it('saklama 0 iken kayıt eklenmez, yanıt yine tam', async () => {
    env.BELGE_BUL_SONUC_SAKLAMA_GUN = 0;
    const res = await request(app).post('/api/documents/find').send(govde);
    expect(res.status).toBe(200);
    expect(res.body.history_id).toEqual(expect.any(String));
    await biraz();
    expect(fake.callsFor('search_results', 'insert')).toHaveLength(0);
  });
});

describe('getDocumentHistory — has_results', () => {
  const gecmis = (id: string, userId = 'u1', ageMs = 0) => ({
    id,
    user_id: userId,
    search_type: 'doc_finder',
    query: `q-${id}`,
    filters: {},
    results_count: 3,
    created_at: iso(Date.now() - ageMs),
  });
  const H = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

  it('öğeler has_results taşır: taze kayıt true, kayıtsız ve süresi dolmuş false, başka kullanıcının kaydı false', async () => {
    fake.seed('search_history', [
      gecmis(H(1), 'u1', 1_000),
      gecmis(H(2), 'u1', 2_000),
      gecmis(H(3), 'u1', 3_000),
      gecmis(H(4), 'u1', 4_000),
    ]);
    const now = Date.now();
    fake.seed('search_results', [
      { id: 'r1', history_id: H(1), user_id: 'u1', created_at: iso(now - 1 * GUN), response: { big: true } },
      { id: 'r3', history_id: H(3), user_id: 'u1', created_at: iso(now - 8 * GUN), response: {} },
      { id: 'r4', history_id: H(4), user_id: 'u2', created_at: iso(now - 1 * GUN), response: {} },
    ]);

    const res = await request(app).get('/api/documents/history');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string; has_results: boolean }) => [i.id, i.has_results])).toEqual([
      [H(1), true],
      [H(2), false],
      [H(3), false],
      [H(4), false],
    ]);
    expect(res.body.items[0]).toEqual(
      expect.objectContaining({ id: H(1), query: `q-${H(1)}`, results_count: 3, filters: {}, created_at: expect.any(String) })
    );
  });

  it('has_results sorgusu response sütununu okumaz; yalnız dilimlenmiş sayfanın id\'leriyle sorulur', async () => {
    fake.seed('search_history', [gecmis(H(1), 'u1', 1_000), gecmis(H(2), 'u1', 2_000), gecmis(H(3), 'u1', 3_000)]);
    const res = await request(app).get('/api/documents/history?limit=2');
    expect(res.body.hasMore).toBe(true);
    expect(res.body.items).toHaveLength(2);

    const sorgular = fake.callsFor('search_results', 'select');
    expect(sorgular).toHaveLength(1);
    expect(sorgular[0]!.columns).toBe('history_id, created_at');
    const inSuzgec = sorgular[0]!.filters.find((f) => f.op === 'in');
    expect(inSuzgec!.value).toEqual([H(1), H(2)]); // limit+1'inci satır (H(3)) dışarıda
    for (const c of fake.callsFor('search_results')) expect(c.columns ?? '').not.toContain('response');
  });

  it('liste sorgusu gömülü ilişki (embed) kullanmaz', async () => {
    fake.seed('search_history', [gecmis(H(1))]);
    await request(app).get('/api/documents/history');
    const [liste] = fake.callsFor('search_history', 'select');
    expect(liste!.columns).toBe('id, query, filters, results_count, created_at');
  });

  it('boş geçmişte search_results sorgusu atılmaz', async () => {
    const res = await request(app).get('/api/documents/history');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(fake.callsFor('search_results')).toHaveLength(0);
  });

  it('tablo yokken (PGRST205) liste yine 200 döner, has_results hepsi false', async () => {
    fake.seed('search_history', [gecmis(H(1), 'u1', 1_000), gecmis(H(2), 'u1', 2_000)]);
    fake.failOn('search_results', 'select', { code: 'PGRST205', message: 'tablo yok' });

    const res = await request(app).get('/api/documents/history');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { has_results: boolean }) => i.has_results)).toEqual([false, false]);
  });

  it('saklama 0 iken has_results hepsi false, search_results sorgulanmaz', async () => {
    env.BELGE_BUL_SONUC_SAKLAMA_GUN = 0;
    fake.seed('search_history', [gecmis(H(1))]);
    fake.seed('search_results', [{ id: 'r1', history_id: H(1), user_id: 'u1', created_at: iso(Date.now()) }]);
    const res = await request(app).get('/api/documents/history');
    expect(res.body.items[0].has_results).toBe(false);
    expect(fake.callsFor('search_results')).toHaveLength(0);
  });
});

describe('getSavedResults', () => {
  const ID = '00000000-0000-4000-8000-0000000000b1';
  const response = beyinYaniti();
  const istek = {
    query: 'örtülü sermaye',
    filters: { daire: '3. Daire' },
    per_corpus: 50,
    smart: false,
    rerank: true,
  };

  const kayit = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    history_id: ID,
    user_id: 'u1',
    created_at: iso(Date.now() - 2 * GUN),
    request: istek,
    response,
    ...over,
  });

  it('sahibine, süre içinde: 200 {query, created_at, request(sorgusuz), response}; kredi düşmez', async () => {
    const row = kayit();
    fake.seed('search_results', [row]);

    const res = await request(app).get(`/api/documents/history/${ID}/results`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      query: 'örtülü sermaye',
      created_at: row.created_at,
      request: { filters: { daire: '3. Daire' }, per_corpus: 50, smart: false, rerank: true },
      response,
    });
    expect(res.body.response).not.toHaveProperty('newBalance');
    expect(mocks.deductCredits).not.toHaveBeenCalled();
    expect(mocks.browseDocuments).not.toHaveBeenCalled();
  });

  it('başka kullanıcının kaydı → 404', async () => {
    fake.seed('search_results', [kayit({ user_id: 'u2' })]);
    const res = await request(app).get(`/api/documents/history/${ID}/results`);
    expect(res.status).toBe(404);
    expect(mocks.deductCredits).not.toHaveBeenCalled();
  });

  it('süresi dolmuş (8 gün) kayıt → 404', async () => {
    fake.seed('search_results', [kayit({ created_at: iso(Date.now() - 8 * GUN) })]);
    const res = await request(app).get(`/api/documents/history/${ID}/results`);
    expect(res.status).toBe(404);
    expect(mocks.deductCredits).not.toHaveBeenCalled();
  });

  it('kayıt yok → 404', async () => {
    const res = await request(app).get(`/api/documents/history/${ID}/results`);
    expect(res.status).toBe(404);
  });

  it('id uuid değilse 400 değil 404', async () => {
    const res = await request(app).get('/api/documents/history/abc/results');
    expect(res.status).toBe(404);
    expect(fake.callsFor('search_results')).toHaveLength(0);
  });

  // R-S1a: üç durumlu. Okuma hatası (tablo yok, ağ, 5 sn abort) → 503; web bunu ücretli yeniden çalıştırmaya
  // ÇEVİRMEZ (yalnız 404'te yeniden çalıştırır).
  it('Supabase hatası (tablo yok, PGRST205) → 503, 404 DEĞİL', async () => {
    fake.failOn('search_results', 'select', { code: 'PGRST205', message: 'tablo yok' });
    const res = await request(app).get(`/api/documents/history/${ID}/results`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SAVED_RESULT_UNAVAILABLE');
    expect(mocks.deductCredits).not.toHaveBeenCalled();
    expect(mocks.browseDocuments).not.toHaveBeenCalled();
  });

  it('reddedilen çağrı / 5 sn abort zaman aşımı → 503', async () => {
    fake.failOn(
      'search_results',
      'select',
      new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    );
    const res = await request(app).get(`/api/documents/history/${ID}/results`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SAVED_RESULT_UNAVAILABLE');
  });

  it('gerçekten yok (hata yok, satır yok) 503 değil 404', async () => {
    const res = await request(app).get(`/api/documents/history/${ID}/results`);
    expect(res.status).toBe(404);
  });

  it('saklama 0 iken 404', async () => {
    env.BELGE_BUL_SONUC_SAKLAMA_GUN = 0;
    fake.seed('search_results', [kayit()]);
    const res = await request(app).get(`/api/documents/history/${ID}/results`);
    expect(res.status).toBe(404);
  });

  it('request alanı olmayan bozuk satır (sorgu yok) → 404, 500 değil', async () => {
    fake.seed('search_results', [kayit({ request: null })]);
    const res = await request(app).get(`/api/documents/history/${ID}/results`);
    expect(res.status).toBe(404);
  });
});

describe('documentsRouter', () => {
  it('GET /history/:id/results kayıtlı ve aiLimiter\'sız (yalnız requireAuth altında)', () => {
    const stack = (
      documentsRouter as unknown as {
        stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: unknown[] } }>;
      }
    ).stack;
    const rota = stack.find((l) => l.route?.path === '/history/:id/results');
    expect(rota?.route?.methods.get).toBe(true);
    expect(rota?.route?.stack).toHaveLength(1); // yalnız controller (aiLimiter yok)
  });
});
