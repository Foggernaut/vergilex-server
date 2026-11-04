import { logger } from '../config/logger.js';

/**
 * Henüz migrate edilmemiş olabilen (OPSİYONEL) bir kolonla çalışan sorgular için.
 *
 * NEDEN: ürün DB'sine migration'lar her zaman deploy'dan önce uygulanmıyor (013 trust_*,
 * 012 conversation_id örnekleri). Yeni kolonu yazan/okuyan kod migration'dan önce canlıya
 * çıkarsa PostgREST bilinmeyen kolonu reddeder → mesaj kaydı ya da geçmiş yükleme KIRILIR.
 * Bu yardımcı sorguyu önce kolonla dener; reddedilirse (PGRST204 / 42703) kolonsuz bir kez
 * daha dener ve uyarı bırakır. Diğer hatalar aynen döner.
 */
export function isMissingColumn(err: { code?: string } | null | undefined): boolean {
  return !!err && (err.code === 'PGRST204' || err.code === '42703');
}

export async function withOptionalColumn<R extends { error: { code?: string; message?: string } | null }>(
  column: string,
  run: (include: boolean) => PromiseLike<R>,
  context: string
): Promise<R> {
  const first = await run(true);
  if (!isMissingColumn(first.error)) return first;
  logger.warn(`optional column "${column}" missing — migration not applied yet; retrying without it`, {
    context,
    code: first.error?.code,
    message: first.error?.message,
  });
  return run(false);
}

/**
 * `withOptionalColumn`'un birden çok sütunlu hâli: sorgu önce bütün isteğe bağlı sütunlarla denenir;
 * eksik-sütun hatasında hata mesajının ADINI verdiği sütun düşürülüp yeniden denenir, DİĞERLERİ KORUNUR
 * (her sütun ayrı migration'la gelir — ör. 018 envanter, 019 takip önerileri — biri eksik diye öteki
 * kaybolmasın). Adı okunamazsa kalan isteğe bağlı sütunların hepsi birden düşer. Eksik sütun başına bir
 * deneme — iç içe sarmanın katlanan denemesi yok; migration gelene dek her kayıt/yükleme bunu öder.
 * Diğer hatalar aynen döner. `run` o denemede dahil edilen sütunların kümesini alır.
 */
export async function withOptionalColumns<R extends { error: { code?: string; message?: string } | null }>(
  columns: readonly string[],
  run: (included: ReadonlySet<string>) => PromiseLike<R>,
  context: string
): Promise<R> {
  let included = new Set(columns);
  for (;;) {
    const res = await run(included);
    if (!isMissingColumn(res.error) || included.size === 0) return res;
    // PGRST204: "Could not find the 'X' column of 'messages' …"; 42703: "column messages.X does not exist".
    const message = res.error?.message ?? '';
    const named = [...included].filter((c) => message.includes(c));
    const drop = named.length ? named : [...included];
    logger.warn(`optional column(s) ${drop.map((c) => `"${c}"`).join(', ')} missing — migration not applied yet; retrying without`, {
      context,
      code: res.error?.code,
      message,
    });
    included = new Set([...included].filter((c) => !drop.includes(c)));
  }
}
