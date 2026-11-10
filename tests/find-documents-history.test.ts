// POST find-documents: geçmiş satırına tebliğ kutusunun yalnız özeti yazılır, HTTP yanıtı TAM kalır.
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  browseDocuments: vi.fn(),
  deductCredits: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('../src/brain/brain.client.js', () => ({ brainClient: { browseDocuments: mocks.browseDocuments } }));
vi.mock('../src/modules/credits/credits.service.js', () => ({ deductCredits: mocks.deductCredits }));
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: { from: () => ({ insert: mocks.insert }) },
}));

import { findDocuments } from '../src/modules/documents/documents.controller.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.post('/api/documents/find', (req, _res, next) => {
  (req as unknown as { user: unknown }).user = { id: 'u1', role: 'user' };
  next();
}, findDocuments);
app.use(errorHandler);

const etkilenen = Array.from({ length: 200 }, (_, i) => ({
  chunk_id: `c${i}`,
  document_id: 'TEBL-1',
  etiket: `Bölüm ${i}`,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deductCredits.mockResolvedValue({ newBalance: 42 });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.browseDocuments.mockResolvedValue({
    documents: [],
    total_found: 0,
    per_corpus_counts: {},
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
  });
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
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    const row = mocks.insert.mock.calls[0][0];
    expect(row.filters.applied.teblig_kimlik).toEqual({
      aranan: 'KDV GUT',
      durum: 'ana_metne_islenmis',
      sabit_id: 'TEBL-1',
      etkilenen_toplam: 412,
      aile_toplam: 9,
    });
    expect(row.filters.applied.semantic_query).toBe('kdv');
    expect(row.filters.per_corpus_counts).toEqual({});
  });
});
