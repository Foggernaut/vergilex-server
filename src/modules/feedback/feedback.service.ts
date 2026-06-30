import { supabaseAdmin } from '../../config/supabase.js';
import { brainClient } from '../../brain/brain.client.js';
import { logger } from '../../config/logger.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

interface FeedbackResult {
  success: true;
  rating: number;
  /** Whether the vote was forwarded to the brain's eval pipeline. */
  forwardedToBrain: boolean;
}

/**
 * Record a user's 👍/👎 on an assistant answer.
 *
 * The user's vote is stored on the message row (authoritative for UI state),
 * then best-effort forwarded to the brain's POST /v2/feedback so downvotes feed
 * its eval "needs investigation" list. A brain forward failure (e.g. audit
 * Supabase not configured) never fails the request — the local vote stands.
 *
 * Ownership is enforced via the message's conversation, and we key on messageId
 * (not a raw request_id) so a user can only rate answers they actually received.
 */
export async function submitMessageFeedback(args: {
  userId: string;
  messageId: string;
  rating: number;
  note?: string;
}): Promise<FeedbackResult> {
  // Look up the message in the chat tables first, then the Mevzuat Asistanı
  // tables (assistant_messages / assistant_conversations). Both share the same
  // shape, so the shared 👍/👎 component posts a messageId without knowing which
  // feature produced it. !inner drops rows whose conversation doesn't match, so
  // a wrong user_id yields no row.
  type Owner = { user_id: string; deleted_at: string | null };
  type MsgRow = { role: string; brain_request_id: string | null; owner?: Owner };

  let table: 'messages' | 'assistant_messages' = 'messages';
  let row: MsgRow | null = null;

  {
    const { data } = await supabaseAdmin
      .from('messages')
      .select('id, role, brain_request_id, conversations!inner(user_id, deleted_at)')
      .eq('id', args.messageId)
      .single();
    const r = data as (MsgRow & { conversations?: Owner }) | null;
    if (r) row = { role: r.role, brain_request_id: r.brain_request_id, owner: r.conversations };
  }
  if (!row) {
    const { data } = await supabaseAdmin
      .from('assistant_messages')
      .select('id, role, brain_request_id, assistant_conversations!inner(user_id, deleted_at)')
      .eq('id', args.messageId)
      .single();
    const r = data as (MsgRow & { assistant_conversations?: Owner }) | null;
    if (r) {
      row = { role: r.role, brain_request_id: r.brain_request_id, owner: r.assistant_conversations };
      table = 'assistant_messages';
    }
  }

  const conv = row?.owner;
  if (!row || !conv || conv.user_id !== args.userId || conv.deleted_at) {
    throw new NotFoundError('Mesaj bulunamadı');
  }
  if (row.role !== 'assistant') {
    throw new ValidationError('Yalnızca yanıtlar oylanabilir');
  }

  // 1) Authoritative local store — drives the thumbs UI state across reloads.
  const { error: updateError } = await supabaseAdmin
    .from(table)
    .update({ feedback_rating: args.rating })
    .eq('id', args.messageId);
  if (updateError) throw updateError;

  // 2) Best-effort forward to the brain eval pipeline. Only the audited v2 path
  //    carries a brain_request_id; v1 answers simply skip the forward.
  let forwardedToBrain = false;
  const requestId = row.brain_request_id;
  if (requestId) {
    try {
      const res = await brainClient.submitFeedback({
        request_id: requestId,
        rating: args.rating,
        note: args.note,
        user_id: args.userId,
      });
      forwardedToBrain = res.success;
      if (!res.success) {
        logger.warn('Brain feedback not recorded', { requestId, error: res.error });
      }
    } catch (err) {
      logger.warn('Brain feedback forward failed (vote stored locally)', {
        requestId,
        err: err instanceof Error ? err.message : err,
      });
    }
  }

  return { success: true, rating: args.rating, forwardedToBrain };
}
