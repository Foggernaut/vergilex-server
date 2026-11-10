import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AuthError, NotFoundError } from '../../utils/errors.js';
import { brainClient } from '../../brain/brain.client.js';
import { deductCredits } from '../credits/credits.service.js';
import { CREDIT_COSTS } from '../../utils/creditCosts.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { logger } from '../../config/logger.js';
import { MAX_QUERY_CHARS, MIN_QUERY_CHARS } from '../../utils/queryLimits.js';
import { historyApplied } from './historyApplied.js';
import { kayitliSonuc, kayitliSonucIdleri, sonucKaydedilmeli, sonucuKaydet } from './searchResults.js';

// Belge Bul = advanced search: LLM query-parse (smart) + facet filters + hybrid/rerank.
// Deep per-corpus recall, parent-deduped, paginated client-side.
const facetSchema = z
  .object({
    corpora: z.array(z.string()).nullable().optional(),
    law_id: z.string().nullable().optional(),
    madde_no: z.string().nullable().optional(),
    daire: z.string().nullable().optional(),
    date_from: z.string().nullable().optional(),
    date_to: z.string().nullable().optional(),
    madde_tipi: z.string().nullable().optional(),
    exclude_mulga: z.boolean().optional(),
  })
  .optional();

const docFinderSchema = z.object({
  query: z.string().min(MIN_QUERY_CHARS).max(MAX_QUERY_CHARS),
  filters: facetSchema,
  per_corpus: z.number().int().min(1).max(200).optional(),
  smart: z.boolean().optional(),
  rerank: z.boolean().optional(),
});

export const findDocuments: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = docFinderSchema.parse(req.body);

    const result = await brainClient.browseDocuments({
      query: input.query,
      filters: input.filters ?? undefined,
      per_corpus: input.per_corpus,
      smart: input.smart,
      rerank: input.rerank,
    });

    const { newBalance } = await deductCredits({
      userId: req.user.id,
      amount: CREDIT_COSTS.doc_finder,
      type: 'doc_finder',
      description: input.query.slice(0, 200),
      metadata: {
        results_count: result.documents.length,
        cost: result.cost,
      },
    });

    // Kullanıcının gönderdiği istek: geçmiş satırına sorgusuz yazılır (`filters.request`; süresi dolmuş bir
    // aramayı aynı filtrelerle yeniden çalıştırmak için, kalıcıdır); saklanan sonuca sorgu dahil yazılır.
    const istek = {
      filters: input.filters,
      per_corpus: input.per_corpus,
      smart: input.smart,
      rerank: input.rerank,
    };

    // id geri alınır (history_id): hata/zaman aşımı olursa null — geçmiş yazımı yanıtı bozmaz (kredi zaten
    // düştü), uyarı günlüğe yazılır. 5 sn sınırı: bu çağrı yanıttan ÖNCE yapılır ve global undici zaman aşımı
    // (420 sn) Supabase fetch'iyle paylaşılır.
    const gecmisSatiri = {
      user_id: req.user.id,
      query: input.query,
      search_type: 'doc_finder',
      // applied.teblig_kimlik: geçmişe yalnız özet yazılır (bkz. historyApplied); yanıt tam kalır.
      // kaynak_envanteri: grup başlıklı tür sayaçları (araştırma protokolü Faz 5) — filters jsonb'de, migration gerekmez.
      filters: {
        applied: historyApplied(result.applied),
        per_corpus_counts: result.per_corpus_counts,
        kaynak_envanteri: result.kaynak_envanteri ?? null,
        request: istek,
      },
      results_count: result.documents.length,
    };
    let historyId: string | null = null;
    try {
      const { data: gecmis, error: gecmisHata } = await supabaseAdmin
        .from('search_history')
        .insert(gecmisSatiri)
        .select('id')
        .abortSignal(AbortSignal.timeout(5000))
        .single();
      if (gecmisHata) {
        logger.warn('search_history insert failed — history_id null', {
          code: gecmisHata.code,
          message: gecmisHata.message,
        });
      }
      historyId = gecmis?.id ?? null;
    } catch (err) {
      logger.warn('search_history insert threw — history_id null', {
        err: err instanceof Error ? err.message : err,
      });
    }

    // Kaydedilip kaydedilmeyeceği yanıttan ÖNCE hesaplanır: res.json'dan sonra next(err)'e düşebilecek hiçbir
    // şey kalmaz (errorHandler'da headersSent koruması yok).
    const kaydet = historyId !== null && sonucKaydedilmeli(result);

    res.json({ ...result, history_id: historyId, newBalance });

    // Kayıtlı sonuç yanıttan SONRA, beklenmeden yazılır (ölümcül değil; sonucuKaydet hiçbir hatayı fırlatmaz).
    if (kaydet && historyId) {
      void sonucuKaydet({
        historyId,
        userId: req.user.id,
        request: { query: input.query, ...istek },
        response: result,
      });
    }
  } catch (err) {
    next(err);
  }
};

// Belge Bul Geçmiş — kullanıcının doc_finder aramaları, sayfalı (limit+1 → hasMore,
// katalog controller'ıyla aynı desen). Salt-okunur; kredi/aiLimiter yok. idx_history_user_created
// (user_id, created_at DESC) bu sorguya birebir uyar. "Son Aramalar" da bunu küçük limit ile çağırır.
const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const getDocumentHistory: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { page, limit } = historyQuerySchema.parse(req.query);
    const from = (page - 1) * limit;
    const to = from + limit; // inclusive → limit+1 satır (fazladan satır hasMore'u yoklar)

    const { data, error } = await supabaseAdmin
      .from('search_history')
      .select('id, query, filters, results_count, created_at')
      .eq('user_id', req.user.id)
      .eq('search_type', 'doc_finder')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const items: Array<{ id: string }> = hasMore ? rows.slice(0, limit) : rows;

    // has_results: yalnız dilimlenmiş sayfanın id'leri (limit+1'inci satır değil) için, ayrı hafif sorgu —
    // `response` okunmaz; tablo yoksa kayitliSonucIdleri boş küme döner, liste kırılmaz.
    const kayitli = await kayitliSonucIdleri(
      items.map((i) => i.id),
      req.user.id
    );
    res.json({
      page,
      limit,
      hasMore,
      items: items.map((i) => ({ ...i, has_results: kayitli.has(i.id) })),
    });
  } catch (err) {
    next(err);
  }
};

// Kayıtlı Belge Bul yanıtı (Geçmiş'ten tıklama). Kredi düşmez, beyne gidilmez, aiLimiter yok (genel sınır
// yeterli). ÜÇ DURUMLU: bulundu → 200; gerçekten yok / süresi dolmuş / başkasının / geçersiz id / saklama
// kapalı → 404 (web aramayı yeniden çalıştırır, 2 KR); Supabase hatası ya da zaman aşımı → 503 (kayitliSonuc
// fırlatır; web yeniden çalıştırmaz, Geçmiş'te kalır). Geçersiz id 400 değil 404.
export const getSavedResults: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new NotFoundError('Kayıtlı sonuç bulunamadı');

    const kayit = await kayitliSonuc(id.data, req.user.id);
    const saklananIstek = kayit?.request;
    // Sorgu `request`'ten gelir; yoksa (bozuk satır) kayıt yok sayılır → web yeniden çalıştırır.
    if (
      !kayit ||
      !saklananIstek ||
      typeof saklananIstek !== 'object' ||
      typeof (saklananIstek as { query?: unknown }).query !== 'string'
    ) {
      throw new NotFoundError('Kayıtlı sonuç bulunamadı');
    }

    const { query, ...istek } = saklananIstek as { query: string } & Record<string, unknown>;
    res.json({ query, created_at: kayit.created_at, request: istek, response: kayit.response });
  } catch (err) {
    next(err);
  }
};
