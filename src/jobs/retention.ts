// KVKK md.7 / saklama politikası: kullanıcının sildiği sohbetler önce soft-delete
// (deleted_at) ile görünmez olur, RETENTION_DELETED_CONVERSATION_DAYS (varsayılan
// 30 — Aydınlatma Metni §6 ile aynı) sonra KALICI silinir. 0 = kapalı.
//
// Kalıcı silme, sohbetle birlikte ona bağlı her izi de siler — yoksa iz erişilemez
// hâle gelir (sohbet gidince brain_request_id'ler de gider):
//   1. Süresi dolan sohbet id'leri sınırlı partiler hâlinde (keyset, id sırası) seçilir.
//   2. Partinin mesajlarındaki brain_request_id'ler toplanır → brain audit izi
//      YALNIZ bu request id'lerle silinir. user_id ASLA gönderilmez: o, kullanıcının
//      TÜM audit geçmişini silerdi (hesap silme davranışı), burada istenen değil.
//   3. Silme başarısızsa parti bu çalıştırmada ATLANIR (log; yarın yeniden denenir) —
//      sohbet ve izleri olduğu gibi kalır, yarım silme olmaz.
//   4. search_history satırları (soru metnini taşır; FK ON DELETE SET NULL olduğu için
//      sohbetle gitmez) conversation_id ile silinir (search_results CASCADE ile gider).
//   5. Sohbetler id ile silinir (messages / assistant_messages CASCADE).
// Her adım idempotent: birden çok replika aynı partiyi işlerse ikincisi 0 satır siler.
import { brainClient } from '../brain/brain.client.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { runWithoutSubject } from '../utils/requestContext.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH = 100;
const PAGE = 1000;
// Art arda bu kadar parti için audit silme başarısızsa brain sağlıksızdır: tablo bu
// çalıştırmada bırakılır (her parti bir zaman aşımı beklemesin), yarın yeniden denenir.
const MAX_CONSECUTIVE_ERASE_FAILURES = 3;

interface PurgeSpec {
  table: 'conversations' | 'assistant_conversations';
  messages: 'messages' | 'assistant_messages';
  /** search_history.conversation_id yalnız public.conversations'a bağlıdır (migration 012). */
  historyLinked: boolean;
}

const SPECS: readonly PurgeSpec[] = [
  { table: 'conversations', messages: 'messages', historyLinked: true },
  { table: 'assistant_conversations', messages: 'assistant_messages', historyLinked: false },
];

async function collectRequestIds(messagesTable: string, conversationIds: string[]): Promise<string[]> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(messagesTable)
      .select('brain_request_id')
      .in('conversation_id', conversationIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${messagesTable} select failed: ${error.message}`);
    const rows = (data ?? []) as { brain_request_id: string | null }[];
    for (const r of rows) if (r.brain_request_id) ids.add(String(r.brain_request_id));
    if (rows.length < PAGE) return [...ids];
  }
}

/** One batch; returns the number of conversations deleted, or 'erase_failed' / 'skipped'. */
async function purgeBatch(
  spec: PurgeSpec,
  ids: string[],
  cutoff: string
): Promise<number | 'erase_failed' | 'skipped'> {
  let requestIds: string[];
  try {
    requestIds = await collectRequestIds(spec.messages, ids);
  } catch (err) {
    logger.error('Retention: message scan failed, batch skipped', { table: spec.table, err: String(err) });
    return 'skipped';
  }

  if (requestIds.length) {
    try {
      // request_ids ONLY — never user_id. runWithoutSubject: no X-Subject-Id even
      // if a purge is ever started from inside a user's request.
      await runWithoutSubject(() => brainClient.eraseAuditTrail({ request_ids: requestIds }));
    } catch (err) {
      logger.error('Retention: audit erasure failed, batch skipped (retried next run)', {
        table: spec.table,
        conversations: ids.length,
        requests: requestIds.length,
        err: err instanceof Error ? err.message : String(err),
      });
      return 'erase_failed';
    }
  }

  if (spec.historyLinked) {
    const { error } = await supabaseAdmin.from('search_history').delete().in('conversation_id', ids);
    if (error) {
      // Deleting the conversation now would SET NULL the link and strand the
      // question text in search_history for good — keep both, retry next run.
      logger.error('Retention: search_history delete failed, batch skipped', {
        table: spec.table,
        err: error.message,
      });
      return 'skipped';
    }
  }

  // Re-assert the cutoff so a row that no longer qualifies is never deleted.
  const { data, error } = await supabaseAdmin
    .from(spec.table)
    .delete()
    .in('id', ids)
    .lt('deleted_at', cutoff)
    .select('id');
  if (error) {
    logger.error('Retention: conversation delete failed', { table: spec.table, err: error.message });
    return 'skipped';
  }
  return (data ?? []).length;
}

async function purgeTable(spec: PurgeSpec, cutoff: string, batchSize: number): Promise<number> {
  let purged = 0;
  let skippedBatches = 0;
  let consecutiveEraseFailures = 0;
  let lastId: string | null = null;

  for (;;) {
    let q = supabaseAdmin.from(spec.table).select('id').lt('deleted_at', cutoff);
    if (lastId !== null) q = q.gt('id', lastId);
    const { data, error } = await q.order('id', { ascending: true }).limit(batchSize);
    if (error) {
      logger.error('Retention purge: select failed', { table: spec.table, err: error.message });
      break;
    }
    const ids = ((data ?? []) as { id: string }[]).map((r) => String(r.id));
    if (!ids.length) break;
    lastId = ids[ids.length - 1] ?? null;

    const result = await purgeBatch(spec, ids, cutoff);
    if (typeof result === 'number') {
      purged += result;
      consecutiveEraseFailures = 0;
    } else {
      skippedBatches += 1;
      if (result === 'erase_failed' && ++consecutiveEraseFailures >= MAX_CONSECUTIVE_ERASE_FAILURES) {
        logger.error('Retention purge: brain erasure keeps failing, stopping this table until next run', {
          table: spec.table,
        });
        break;
      }
    }
    if (ids.length < batchSize) break;
  }

  if (skippedBatches) logger.warn('Retention purge: batches skipped', { table: spec.table, skippedBatches });
  return purged;
}

export async function purgeDeletedConversations(
  now = Date.now(),
  opts: { batchSize?: number } = {}
): Promise<Record<string, number>> {
  const days = env.RETENTION_DELETED_CONVERSATION_DAYS;
  const out: Record<string, number> = {};
  if (!days) return out;
  const cutoff = new Date(now - days * DAY_MS).toISOString();
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH);
  for (const spec of SPECS) {
    out[spec.table] = await purgeTable(spec, cutoff, batchSize);
  }
  logger.info('Retention purge: soft-deleted conversations', { days, ...out });
  return out;
}

/** Açılışta bir kez + her 24 saatte bir. Hata servis açılışını engellemez. */
export function scheduleRetention(): NodeJS.Timeout | null {
  if (!env.RETENTION_DELETED_CONVERSATION_DAYS || env.NODE_ENV === 'test') return null;
  const run = () => void purgeDeletedConversations().catch((e) => logger.error('Retention job crashed', { err: String(e) }));
  setTimeout(run, 60_000).unref();
  const t = setInterval(run, DAY_MS);
  t.unref();
  return t;
}
