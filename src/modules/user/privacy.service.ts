// KVKK md.11 — veri sahibi hakları: verilerime erişim/taşınabilirlik (export) ve silme.
//
// Silme sırası (yarım silme olmasın):
//   1. Kullanıcının tüm brain_request_id'leri toplanır (silinmiş sohbetler dahil).
//   2. Brain /v2/privacy/erase → audit DB izi silinir. Başarısızsa DURULUR (503),
//      hesap silinmez; kullanıcı tekrar dener.
//   3. auth.admin.deleteUser → public.users → tüm kullanıcı tabloları CASCADE.
// Kapsam dışı (aydınlatma metninde belirtilir): Resend'e gönderilmiş e-postalar,
// LLM sağlayıcılarının kendi saklama süreleri, platform (Railway/Vercel) logları.
import { brainClient } from '../../brain/brain.client.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { logger } from '../../config/logger.js';
import { AppError, NotFoundError } from '../../utils/errors.js';

type Row = Record<string, unknown>;
const PAGE = 1000;
const IN_CHUNK = 200;

async function selectAll(table: string, column: string, value: unknown): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('*')
      .eq(column, value)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function selectIn(table: string, column: string, values: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const chunk = values.slice(i, i + IN_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('*')
        .in(column, chunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as Row[];
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
  const { data: profile, error } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, role, credits, created_at, updated_at')
    .eq('id', userId)
    .single();
  if (error || !profile) throw new NotFoundError('Kullanıcı bulunamadı');

  const [convs, aconvs, credit_transactions, favorites, search_history, search_results] =
    await Promise.all([
      selectAll('conversations', 'user_id', userId),
      selectAll('assistant_conversations', 'user_id', userId),
      selectAll('credit_transactions', 'user_id', userId),
      selectAll('favorites', 'user_id', userId),
      selectAll('search_history', 'user_id', userId),
      selectAll('search_results', 'user_id', userId),
    ]);
  const [msgs, amsgs] = await Promise.all([
    selectIn('messages', 'conversation_id', convs.map((c) => String(c.id))),
    selectIn('assistant_messages', 'conversation_id', aconvs.map((c) => String(c.id))),
  ]);

  return {
    export_format: 'vergilex-kvkk-export/1',
    exported_at: new Date().toISOString(),
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
    selectAll('conversations', 'user_id', userId),
    selectAll('assistant_conversations', 'user_id', userId),
  ]);
  const [msgs, amsgs] = await Promise.all([
    selectIn('messages', 'conversation_id', convs.map((c) => String(c.id))),
    selectIn('assistant_messages', 'conversation_id', aconvs.map((c) => String(c.id))),
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
