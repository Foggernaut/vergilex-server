import { brainClient } from '../../brain/brain.client.js';
import { BrainStreamUnsupportedError } from '../../brain/brain.errors.js';
import type { AnswerLength, BrainAnswerRequest, BrainAnswerResponse, BrainHistoryItem } from '../../brain/brain.types.js';
import { supabaseAdmin } from '../../config/supabase.js';
import {
  DEFAULT_ANSWER_LENGTH,
  assistantChatCost,
  assistantFollowUpCost,
} from '../../utils/creditCosts.js';
import { getBalance } from '../credits/credits.service.js';
import { InsufficientCreditsError, NotFoundError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import type { SseWriter } from '../../utils/sse.js';
import {
  followUpAssistant,
  startAssistantChat,
  type AssistantPersistResult,
} from './assistant.service.js';

/**
 * SSE streaming for Mevzuat Asistanı. Identical relay semantics to
 * chat.stream.service: balance is checked BEFORE any SSE header (so a 402 is a
 * clean JSON error); the brain's masked phase + answer_delta events are relayed;
 * on `complete` we persist + bill exactly once. A disconnect before completion
 * aborts the brain (via `signal`) and charges nothing.
 */

const MAX_HISTORY_TURNS = 6;
const HEARTBEAT_MS = 10_000;

export async function streamAssistantChat(
  args: {
    userId: string;
    query: string;
    filters?: { law_id?: string | null; corpora?: string[] };
    answer_length?: AnswerLength;
  },
  sse: SseWriter,
  signal: AbortSignal
): Promise<void> {
  const length = args.answer_length ?? DEFAULT_ANSWER_LENGTH;
  await assertCanAfford(args.userId, assistantChatCost(length));

  const brainReq: BrainAnswerRequest = {
    query: args.query,
    filters: args.filters,
    answer_length: length,
  };

  await pipe(sse, signal, brainReq, (precomputedAnswer) =>
    startAssistantChat({
      userId: args.userId,
      query: args.query,
      filters: args.filters,
      answer_length: length,
      precomputedAnswer,
    })
  );
}

export async function streamAssistantFollowUp(
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
    .from('assistant_conversations')
    .select('id, user_id, filters')
    .eq('id', args.conversationId)
    .is('deleted_at', null)
    .single();
  if (convError || !conv || conv.user_id !== args.userId) {
    throw new NotFoundError('Sohbet bulunamadı');
  }

  await assertCanAfford(args.userId, assistantFollowUpCost(length));

  const { data: prior, error: priorError } = await supabaseAdmin
    .from('assistant_messages')
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
    followUpAssistant({
      userId: args.userId,
      conversationId: args.conversationId,
      query: args.query,
      answer_length: length,
      precomputedAnswer,
    })
  );
}

// ── internals ──────────────────────────────────────────────────────────────

async function assertCanAfford(userId: string, cost: number): Promise<void> {
  if (cost <= 0) return;
  const balance = await getBalance(userId);
  if (balance < cost) throw new InsufficientCreditsError();
}

async function pipe(
  sse: SseWriter,
  signal: AbortSignal,
  brainReq: BrainAnswerRequest,
  persist: (precomputedAnswer?: BrainAnswerResponse) => Promise<AssistantPersistResult>
): Promise<void> {
  sse.init();
  const heartbeat = setInterval(() => sse.ping(), HEARTBEAT_MS);

  try {
    let complete: BrainAnswerResponse | null = null;
    try {
      for await (const ev of brainClient.assistantAnswerStream(brainReq, signal)) {
        if (ev.type === 'phase') {
          sse.event('phase', { phase: ev.phase });
        } else if (ev.type === 'layer1') {
          sse.event('layer1', { documents: ev.documents });
        } else if (ev.type === 'layer2') {
          sse.event('layer2', { corpus: ev.corpus, label: ev.label, summary: ev.summary });
        } else if (ev.type === 'layer3_delta') {
          sse.event('layer3_delta', { text: ev.text });
        } else if (ev.type === 'error') {
          sse.event('error', { code: ev.code, message: ev.message });
          return;
        } else if (ev.type === 'complete') {
          complete = ev.response;
        }
      }
    } catch (streamErr) {
      if (streamErr instanceof BrainStreamUnsupportedError) {
        logger.warn('Brain /v2/assistant stream unsupported — falling back to buffered');
        // Buffered fallback: emit the essay as one layer3 chunk; the `complete`
        // payload carries Katman 1 (sources) + Katman 2 (corpus_summaries) so the
        // UI renders all three layers from it.
        const persisted = await persist();
        if (persisted.message.content) {
          sse.event('layer3_delta', { text: persisted.message.content });
        }
        sse.event('complete', persisted);
        return;
      }
      throw streamErr;
    }

    if (!complete) {
      if (!signal.aborted) {
        sse.event('error', {
          code: 'BRAIN_INCOMPLETE',
          message: 'Yanıt tamamlanamadı, lütfen tekrar deneyin',
        });
      }
      return;
    }

    const persisted = await persist(complete);
    sse.event('complete', persisted);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? 'INTERNAL';
    const message =
      (err as { userMessage?: string })?.userMessage ?? 'Beklenmeyen bir hata oluştu';
    logger.error('Assistant stream pipe error', { code, message });
    sse.event('error', { code, message });
  } finally {
    clearInterval(heartbeat);
    sse.close();
  }
}
