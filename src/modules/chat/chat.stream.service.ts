import { supabaseAdmin } from '../../config/supabase.js';
import { brainClient } from '../../brain/brain.client.js';
import { BrainStreamUnsupportedError } from '../../brain/brain.errors.js';
import type {
  AnswerLength,
  BrainAnswerRequest,
  BrainAnswerResponse,
  BrainHistoryItem,
} from '../../brain/brain.types.js';
import { DEFAULT_ANSWER_LENGTH, v2ChatCost } from '../../utils/creditCosts.js';
import { getBalance } from '../credits/credits.service.js';
import { InsufficientCreditsError, NotFoundError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import type { SseWriter } from '../../utils/sse.js';
import { followUp, startConversation, type ChatEngine } from './chat.service.js';

const MAX_HISTORY_TURNS = 6;
const HEARTBEAT_MS = 10_000;

/**
 * Stream a NEW V2 conversation over SSE.
 *
 * Pre-flight (balance check) runs BEFORE any SSE header is written, so a 402 is
 * returned as a normal JSON error. Once streaming starts, the brain's masked
 * `phase` + `answer_delta` events are relayed to the browser; on the brain's
 * `complete` we persist + bill exactly once (reusing startConversation) and emit
 * the augmented `complete`. Billing/persistence only happen on completion — a
 * disconnect before then aborts the brain (via `signal`) and charges nothing.
 */
export async function streamConversation(
  args: {
    userId: string;
    query: string;
    filters?: { law_id?: string | null };
    answer_length?: AnswerLength;
  },
  sse: SseWriter,
  signal: AbortSignal
): Promise<void> {
  const length = args.answer_length ?? DEFAULT_ANSWER_LENGTH;
  await assertCanAfford(args.userId);

  const brainReq: BrainAnswerRequest = {
    query: args.query,
    filters: args.filters,
    answer_length: length,
  };

  await pipe(sse, signal, brainReq, (precomputedAnswer) =>
    startConversation({
      userId: args.userId,
      query: args.query,
      filters: args.filters,
      answer_length: length,
      engine: 'v2',
      precomputedAnswer,
    })
  );
}

/**
 * Stream a V2 follow-up over SSE. Validates the conversation + builds history
 * pre-SSE (so ownership errors are clean JSON), then mirrors streamConversation.
 */
export async function streamFollowUp(
  args: {
    userId: string;
    conversationId: string;
    query: string;
    answer_length?: AnswerLength;
  },
  sse: SseWriter,
  signal: AbortSignal
): Promise<void> {
  const length = args.answer_length ?? DEFAULT_ANSWER_LENGTH;

  const { data: conv, error: convError } = await supabaseAdmin
    .from('conversations')
    .select('id, user_id, filters, engine')
    .eq('id', args.conversationId)
    .is('deleted_at', null)
    .single();
  if (convError || !conv || conv.user_id !== args.userId) {
    throw new NotFoundError('Sohbet bulunamadı');
  }
  const engine: ChatEngine = (conv.engine as ChatEngine | null) ?? 'v1';
  if (engine !== 'v2') throw new NotFoundError('Sohbet bulunamadı');

  await assertCanAfford(args.userId);

  const { data: prior, error: priorError } = await supabaseAdmin
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_TURNS);
  if (priorError) throw priorError;

  const history: BrainHistoryItem[] = (prior ?? [])
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const brainReq: BrainAnswerRequest = {
    query: args.query,
    filters: (conv.filters ?? undefined) as { law_id?: string | null } | undefined,
    history,
    answer_length: length,
  };

  await pipe(sse, signal, brainReq, (precomputedAnswer) =>
    followUp({
      userId: args.userId,
      conversationId: args.conversationId,
      query: args.query,
      answer_length: length,
      expectedEngine: 'v2',
      precomputedAnswer,
    })
  );
}

// ── internals ──────────────────────────────────────────────────────────────

async function assertCanAfford(userId: string): Promise<void> {
  const cost = v2ChatCost();
  if (cost <= 0) return;
  const balance = await getBalance(userId);
  if (balance < cost) throw new InsufficientCreditsError();
}

/**
 * Core relay: open the brain stream, forward masked events, then persist on
 * completion via `persist` (which reuses the buffered start/followUp path).
 * Falls back to a buffered brain call if the brain lacks the /stream endpoint.
 */
async function pipe(
  sse: SseWriter,
  signal: AbortSignal,
  brainReq: BrainAnswerRequest,
  persist: (precomputedAnswer?: BrainAnswerResponse) => Promise<PersistResult>
): Promise<void> {
  sse.init();
  const heartbeat = setInterval(() => sse.ping(), HEARTBEAT_MS);

  try {
    let complete: BrainAnswerResponse | null = null;
    // TEMP diagnostic: log when each event actually arrives from the brain so we
    // can see whether phase events stream incrementally or bunch up at the end.
    const startedAt = Date.now();
    let firstDeltaLogged = false;

    try {
      for await (const ev of brainClient.answerV2Stream(brainReq, signal)) {
        if (ev.type === 'phase') {
          logger.info('SSE ← phase', { phase: ev.phase, atMs: Date.now() - startedAt });
          sse.event('phase', { phase: ev.phase });
        } else if (ev.type === 'answer_delta') {
          if (!firstDeltaLogged) {
            logger.info('SSE ← first answer_delta', { atMs: Date.now() - startedAt });
            firstDeltaLogged = true;
          }
          sse.event('answer_delta', { text: ev.text });
        } else if (ev.type === 'error') {
          sse.event('error', { code: ev.code, message: ev.message });
          return;
        } else if (ev.type === 'complete') {
          logger.info('SSE ← complete', { atMs: Date.now() - startedAt });
          complete = ev.response;
        }
      }
    } catch (streamErr) {
      if (streamErr instanceof BrainStreamUnsupportedError) {
        // Graceful degradation: brain not upgraded yet → buffered call, then
        // emit the whole answer at once. Persistence/billing identical.
        logger.warn('Brain /stream unsupported — falling back to buffered');
        const persisted = await persist(); // no precomputedAnswer → buffered brain
        if (persisted.message.content) {
          sse.event('answer_delta', { text: persisted.message.content });
        }
        sse.event('complete', persisted);
        return;
      }
      throw streamErr;
    }

    if (!complete) {
      // No validated answer was produced. If the client aborted, bill nothing
      // and stay silent; otherwise the brain ended early → surface a retryable error.
      if (!signal.aborted) {
        sse.event('error', {
          code: 'BRAIN_INCOMPLETE',
          message: 'Yanıt tamamlanamadı, lütfen tekrar deneyin',
        });
      }
      return;
    }

    // Brain produced a guardrail-validated answer → persist + bill exactly once,
    // decoupled from the client connection: even if the browser dropped at the
    // last moment, the work is done so we save the message and charge for it.
    const persisted = await persist(complete);
    sse.event('complete', persisted);
  } catch (err) {
    // Headers are already sent, so surface failures as an SSE `error` frame
    // rather than letting Express try (and fail) to send a JSON error.
    const code = (err as { code?: string })?.code ?? 'INTERNAL';
    const message =
      (err as { userMessage?: string })?.userMessage ?? 'Beklenmeyen bir hata oluştu';
    logger.error('Stream pipe error', { code, message });
    sse.event('error', { code, message });
  } finally {
    clearInterval(heartbeat);
    sse.close();
  }
}

type PersistResult = Awaited<ReturnType<typeof startConversation>>;
