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
 * eksik olan sütun düşürülüp yeniden denenir, DİĞERLERİ KORUNUR (her sütun ayrı migration'la gelir —
 * ör. 018 envanter, 019 takip önerileri — biri eksik diye öteki kaybolmasın). Diğer hatalar aynen döner.
 * `run` o denemede dahil edilen sütunların kümesini alır.
 */
export function withOptionalColumns<R extends { error: { code?: string; message?: string } | null }>(
  columns: readonly string[],
  run: (included: ReadonlySet<string>) => PromiseLike<R>,
  context: string
): Promise<R> {
  const step = (i: number, included: ReadonlySet<string>): Promise<R> => {
    if (i === columns.length) return Promise.resolve(run(included));
    const column = columns[i]!;
    return withOptionalColumn(
      column,
      (include) => step(i + 1, include ? new Set([...included, column]) : included),
      context
    );
  };
  return step(0, new Set());
}
