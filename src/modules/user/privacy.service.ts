// KVKK md.11 — veri sahibi hakları: verilerime erişim/taşınabilirlik (export) ve silme.
//
// Silme sırası (yarım silme olmasın):
//   1. Kullanıcının tüm brain_request_id'leri toplanır (silinmiş sohbetler dahil).
//   2. Brain /v2/privacy/erase → audit DB izi silinir. Başarısızsa (ağ hatası, 2xx
//      dışı ya da 200 + ok:false) DURULUR (503 ERASURE_FAILED),
//      hesap silinmez; kullanıcı tekrar dener.
//   3. auth.admin.deleteUser → public.users → tüm kullanıcı tabloları CASCADE.
// Kapsam dışı (aydınlatma metninde belirtilir): Resend'e gönderilmiş e-postalar,
// LLM sağlayıcılarının kendi saklama süreleri, platform (Railway/Vercel) logları.
import { brainClient } from '../../brain/brain.client.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { logger } from '../../config/logger.js';
import { AppError, NotFoundError } from '../../utils/errors.js';
import { withOptionalColumns } from '../../utils/optionalColumn.js';

type Row = Record<string, unknown>;
const PAGE = 1000;
const IN_CHUNK = 200;

// ── Export column lists ──────────────────────────────────────────────────────
// Explicit lists (never `*`): everything that is the user's personal data, and
// none of the bulky corpus payloads stored next to it (answer `sources`,
// `conflicts`, `corpus_summaries`, `kaynak_envanteri`, `atif_kontrolu`, favorite
// `cached_data`, Belge Bul `response`). Those are public legislation / case-law
// excerpts copied from the corpus, not personal data — see EXPORT_NOTES.
const PROFILE_COLS = 'id, email, full_name, role, credits, created_at, updated_at';
// Migration 023 (KVKK md.10 acceptance record). Optional so the export — itself a
// KVKK right — keeps working on a DB where 023 has not been applied yet.
const CONSENT_COLS = ['terms_version', 'privacy_notice_version', 'terms_accepted_at'] as const;
const CONV_COLS = 'id, title, initial_query, filters, total_credits_used, deleted_at, created_at, updated_at';
const MSG_COLS =
  'id, conversation_id, role, content, credits_used, answer_length, feedback_rating, brain_request_id, created_at';
const CREDIT_COLS = 'id, amount, transaction_type, description, metadata, created_at';
const FAVORITE_COLS = 'id, chunk_id, source_type, notes, created_at';
const HISTORY_COLS = 'id, query, search_type, filters, results_count, conversation_id, created_at';
const SEARCH_RESULT_COLS = 'id, history_id, request, created_at';

const EXPORT_NOTES = [
  'Bu dosya hesabınıza ait kişisel verilerin tamamını içerir: profil ve onay kayıtları, sohbetler, sorularınız ve yanıt metinleri, kredi hareketleri, favoriler, arama geçmişi.',
  'Yanıtlara eşlik eden kaynak listeleri ve alıntıları (sources, conflicts, corpus_summaries, kaynak_envanteri, atif_kontrolu), favorilerin belge kopyaları (cached_data) ve Belge Bul sonuç listeleri (response) dahil edilmemiştir: bunlar mevzuat korpusundan alınan, kamuya açık mevzuat/içtihat metinleridir ve kişisel veri değildir.',
  'brain_request_id, yanıtın denetim (audit) kaydının kimliğidir; hesap silindiğinde bu kayıtlar da silinir.',
];

async function selectAll(table: string, columns: string, column: string, value: unknown): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .eq(column, value)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function selectIn(table: string, columns: string, column: string, values: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const chunk = values.slice(i, i + IN_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select(columns)
        .in(column, chunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Row[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

function nest(convs: Row[], msgs: Row[]): Row[] {
  const by = new Map<string, Row[]>();
  for (const m of msgs) {
    const k = String(m.conversation_id);
    (by.get(k) ?? by.set(k, []).get(k)!).push(m);
  }
  return convs.map((c) => ({ ...c, messages: by.get(String(c.id)) ?? [] }));
}

export async function exportUserData(userId: string): Promise<Row> {
  const { data: profile, error } = await withOptionalColumns(
    CONSENT_COLS,
    (cols) =>
      supabaseAdmin
        .from('users')
        .select([PROFILE_COLS, ...CONSENT_COLS.filter((c) => cols.has(c))].join(', '))
        .eq('id', userId)
        .single(),
    'privacy.exportProfile'
  );
  if (error || !profile) throw new NotFoundError('Kullanıcı bulunamadı');

  const [convs, aconvs, credit_transactions, favorites, search_history, search_results] =
    await Promise.all([
      selectAll('conversations', CONV_COLS, 'user_id', userId),
      selectAll('assistant_conversations', CONV_COLS, 'user_id', userId),
      selectAll('credit_transactions', CREDIT_COLS, 'user_id', userId),
      selectAll('favorites', FAVORITE_COLS, 'user_id', userId),
      selectAll('search_history', HISTORY_COLS, 'user_id', userId),
      selectAll('search_results', SEARCH_RESULT_COLS, 'user_id', userId),
    ]);
  const [msgs, amsgs] = await Promise.all([
    selectIn('messages', MSG_COLS, 'conversation_id', convs.map((c) => String(c.id))),
    selectIn('assistant_messages', MSG_COLS, 'conversation_id', aconvs.map((c) => String(c.id))),
  ]);

  return {
    export_format: 'vergilex-kvkk-export/2',
    exported_at: new Date().toISOString(),
    notes: EXPORT_NOTES,
    profile,
    conversations: nest(convs, msgs),
    assistant_conversations: nest(aconvs, amsgs),
    credit_transactions,
    favorites,
    search_history,
    search_results,
  };
}

async function collectBrainRequestIds(userId: string): Promise<string[]> {
  const [convs, aconvs] = await Promise.all([
    selectAll('conversations', 'id', 'user_id', userId),
    selectAll('assistant_conversations', 'id', 'user_id', userId),
  ]);
  const [msgs, amsgs] = await Promise.all([
    selectIn('messages', 'brain_request_id', 'conversation_id', convs.map((c) => String(c.id))),
    selectIn('assistant_messages', 'brain_request_id', 'conversation_id', aconvs.map((c) => String(c.id))),
  ]);
  const ids = new Set<string>();
  for (const m of [...msgs, ...amsgs]) {
    if (typeof m.brain_request_id === 'string' && m.brain_request_id) ids.add(m.brain_request_id);
  }
  return [...ids];
}

export async function deleteAccount(userId: string): Promise<void> {
  const requestIds = await collectBrainRequestIds(userId);
  try {
    await brainClient.eraseAuditTrail({ request_ids: requestIds, user_id: userId });
  } catch (err) {
    logger.error('Account deletion aborted: audit erasure failed', {
      userId,
      n: requestIds.length,
      err: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(
      503,
      'ERASURE_FAILED',
      'Hesap silme şu anda tamamlanamadı. Hesabınız ve verileriniz değişmedi; lütfen biraz sonra tekrar deneyin.'
    );
  }
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    logger.error('Account deletion: auth delete failed after audit erasure', { userId, err: error.message });
    throw new AppError(500, 'DELETE_FAILED', 'Hesap silinemedi, lütfen destek ile iletişime geçin.');
  }
  logger.info('Account deleted (KVKK md.11)', { userId, auditRequests: requestIds.length });
}
