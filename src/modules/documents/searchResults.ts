import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../utils/errors.js';
import type { BrainBrowseDocumentsResponse } from '../../brain/brain.types.js';

// Belge Bul Geçmiş — aramanın tam yanıtı `search_results` tablosunda BELGE_BUL_SONUC_SAKLAMA_GUN gün
// (varsayılan 7; 0 = kapalı) saklanır; geçmişten tıklanınca kredisiz açılır.
//
// Yazma (`sonucuKaydet`) ve liste etiketi (`kayitliSonucIdleri`) FAIL-OPEN: tablo yokken (migration 020
// uygulanmadan deploy) ya da Supabase yavaş/ölüyken Belge Bul ve Geçmiş listesi çalışmaya devam eder —
// hata yutulur, günlüğe yazılır. `kayitliSonucIdleri` hata/saklama-kapalı durumunda `null` ("bilinmiyor")
// döner; liste `has_results` alanını o zaman HİÇ yazmaz (false yazmak ücretli yeniden çalıştırma etiketi
// olurdu), web eski serbest ön-doldurmaya düşer. `kayitliSonuc` ise ÜÇ DURUMLU: "kayıt yok" (null) ile
// "okunamadı" (503 AppError) ayrılır; web yalnız 404 + SAVED_RESULT_NOT_FOUND kodunda yeniden çalıştırır
// (2 KR), geçici DB hatası ya da uygulamanın genel rota 404'ü ücretli yeniden çalıştırmaya dönmesin.
// Her Supabase çağrısı sınırlıdır: server.ts'teki global undici Agent 420 sn başlık/gövde zaman aşımı taşır ve
// Supabase'in fetch'i onu paylaşır; sınır olmazsa takılan bir çağrı dakikalarca asılı kalır. Küçük çağrılar
// (temizlik, liste etiketi) 5 sn; tam yanıtı taşıyan yazma ve okuma 15 sn — büyük aramaların yanıtı MB'larca
// (canlı 2026-11-11: 1.424 sonuç = 5,2 milyon karakter) ve yazma istemci yanıtından sonra, okuma tek tıkla olur.

const TABLE = 'search_results';
const GUN_MS = 24 * 60 * 60 * 1000;
const CAGRI_ZAMAN_ASIMI_MS = 5_000;
const YANIT_CAGRI_ZAMAN_ASIMI_MS = 15_000;
/**
 * Bundan büyük yanıt (JSON.stringify uzunluğu) saklanmaz: olağan dışı bir yanıt tabloyu şişirmesin. Canlıda
 * görülen en büyük arama (1.424 sonuç) 5,2 milyon karakter; son 30 günde aramaların ~1/6'sı 550+ sonuçlu.
 */
const MAX_YANIT_KARAKTER = 8_000_000;
/** Toplu silme örnek (süreç) başına en çok bu aralıkla çalışır — her kayıtta taranmasın. */
const TEMIZLIK_ARALIGI_MS = 5 * 60 * 1000;

let sonTemizlik = 0;

/** Saklama süresi (gün); çağrı anında okunur, modül yüklenirken değil. 0 = saklama kapalı. */
function saklamaGun(): number {
  return env.BELGE_BUL_SONUC_SAKLAMA_GUN;
}

const sinir = () => AbortSignal.timeout(CAGRI_ZAMAN_ASIMI_MS);
const yanitSiniri = () => AbortSignal.timeout(YANIT_CAGRI_ZAMAN_ASIMI_MS);

/** Saklama süresinin başlangıç eşiği (ISO): bundan eski kayıtların süresi dolmuştur. */
function esikISO(gun: number): string {
  return new Date(Date.now() - gun * GUN_MS).toISOString();
}

/**
 * Yanıt saklanmaya değer mi? Boş sonuç (0 belge) ya da `durum: 'hata'` olan bir korpus (teknik arıza,
 * eksik sonuç) saklanmaz: o aramaya tıklanınca yeniden çalışır. Künye modunda `kaynak_envanteri` null'dır
 * ve belge varsa saklanır.
 */
export function sonucKaydedilmeli(r: BrainBrowseDocumentsResponse): boolean {
  if (r.documents.length === 0) return false;
  const hatali = r.kaynak_envanteri?.gruplar.some((g) => g.korpuslar.some((k) => k.durum === 'hata'));
  return !hatali;
}

async function suresiDolanlariSil(gun: number): Promise<void> {
  const simdi = Date.now();
  if (simdi - sonTemizlik < TEMIZLIK_ARALIGI_MS) return;
  sonTemizlik = simdi; // deneme bile pencereyi tüketir: başarısız silme her istekte yeniden denenmez

  // gun === 0 → eşik now: tablo boşalır (kapatma anahtarı).
  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .lt('created_at', esikISO(gun))
    .abortSignal(sinir());
  if (error) logger.warn('search_results cleanup failed', { code: error.code, message: error.message });
}

/**
 * Yanıtı saklar ve süresi dolmuş TÜM satırları (tüm kullanıcılar) siler. İstemci yanıtı gönderildikten
 * SONRA çağrılır; hiçbir hatayı dışarı fırlatmaz.
 */
export async function sonucuKaydet(a: {
  historyId: string;
  userId: string;
  request: unknown;
  response: unknown;
}): Promise<void> {
  try {
    const gun = saklamaGun();

    if (gun > 0) {
      const json = JSON.stringify(a.response);
      if (json.length > MAX_YANIT_KARAKTER) {
        logger.warn('search_results skipped: response too large', {
          historyId: a.historyId,
          chars: json.length,
          max: MAX_YANIT_KARAKTER,
        });
      } else {
        const { error } = await supabaseAdmin
          .from(TABLE)
          .insert({ history_id: a.historyId, user_id: a.userId, request: a.request, response: a.response })
          .abortSignal(yanitSiniri());
        if (error) {
          logger.warn('search_results insert failed', {
            historyId: a.historyId,
            code: error.code,
            message: error.message,
          });
        } else {
          logger.info('search_results saved', { historyId: a.historyId, bytes: Buffer.byteLength(json) });
        }
      }
    }

    await suresiDolanlariSil(gun);
  } catch (err) {
    logger.warn('search_results save threw', { historyId: a.historyId, err: err instanceof Error ? err.message : err });
  }
}

/**
 * Kayıtlı yanıt: yalnız sahibine ve süresi dolmamışsa döner.
 * - kayıt yok / süresi dolmuş / başkasının / saklama kapalı → `null` (gerçekten yok: controller 404).
 * - Supabase hatası ya da reddedilen çağrı (tablo yok PGRST205, 15 sn AbortSignal dahil) → 503 `AppError`
 *   fırlatır: "yok" ile "okunamadı" karışmasın, web geçici hatayı ücretli yeniden çalıştırmaya çevirmesin.
 */
export async function kayitliSonuc(
  historyId: string,
  userId: string
): Promise<{ created_at: string; request: unknown; response: unknown } | null> {
  const gun = saklamaGun();
  if (gun <= 0) return null;

  let sonuc;
  try {
    sonuc = await supabaseAdmin
      .from(TABLE)
      .select('created_at, request, response')
      .eq('history_id', historyId)
      .eq('user_id', userId)
      .gte('created_at', esikISO(gun))
      .abortSignal(yanitSiniri())
      .maybeSingle();
  } catch (err) {
    logger.warn('search_results read threw', { historyId, err: err instanceof Error ? err.message : err });
    throw okunamadi();
  }
  if (sonuc.error) {
    logger.warn('search_results read failed', {
      historyId,
      code: sonuc.error.code,
      message: sonuc.error.message,
    });
    throw okunamadi();
  }
  return sonuc.data ?? null;
}

const okunamadi = () => new AppError(503, 'SAVED_RESULT_UNAVAILABLE', 'Kayıtlı sonuç şu an okunamıyor');

/**
 * Verilen geçmiş id'lerinden kayıtlı (süresi dolmamış) sonucu olanlar. Yalnız `history_id, created_at`
 * okur — `response` listeye ASLA taşınmaz. Gömülü ilişki (embed) yerine ayrı sorgu: tablo yokken liste kırılmaz.
 *
 * Dönüş: başarılı sorguda `Set` (boş olabilir: "hiçbirinin sonucu yok"); saklama kapalıyken (0) ya da sorgu
 * hata verdiyse `null` = "bilinmiyor" → çağıran `has_results` alanını yazmamalıdır.
 */
export async function kayitliSonucIdleri(historyIds: string[], userId: string): Promise<Set<string> | null> {
  const gun = saklamaGun();
  if (gun <= 0) return null;
  if (historyIds.length === 0) return new Set();
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('history_id, created_at')
      .eq('user_id', userId)
      .in('history_id', historyIds)
      .gte('created_at', esikISO(gun))
      .abortSignal(sinir());
    if (error) {
      logger.warn('search_results ids lookup failed', { code: error.code, message: error.message });
      return null;
    }
    return new Set((data ?? []).map((r: { history_id: string }) => r.history_id));
  } catch (err) {
    logger.warn('search_results ids lookup threw', { err: err instanceof Error ? err.message : err });
    return null;
  }
}
