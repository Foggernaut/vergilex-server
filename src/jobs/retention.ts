// KVKK md.7 / saklama politikası: kullanıcının sildiği sohbetler önce soft-delete
// (deleted_at) ile görünmez olur, RETENTION_DELETED_CONVERSATION_DAYS (varsayılan
// 30 — Aydınlatma Metni §6 ile aynı) sonra KALICI silinir. messages /
// assistant_messages FK ON DELETE CASCADE ile gider; search_history.conversation_id
// ON DELETE SET NULL (geçmiş satırı kalır, sohbete bağı kopar). 0 = kapalı.
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TABLES = ['conversations', 'assistant_conversations'] as const;

export async function purgeDeletedConversations(now = Date.now()): Promise<Record<string, number>> {
  const days = env.RETENTION_DELETED_CONVERSATION_DAYS;
  const out: Record<string, number> = {};
  if (!days) return out;
  const cutoff = new Date(now - days * DAY_MS).toISOString();
  for (const table of TABLES) {
    const { data, error } = await supabaseAdmin.from(table).delete().lt('deleted_at', cutoff).select('id');
    if (error) {
      logger.error('Retention purge failed', { table, err: error.message });
      continue;
    }
    out[table] = (data ?? []).length;
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
