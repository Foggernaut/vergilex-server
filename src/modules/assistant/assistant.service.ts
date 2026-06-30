import { supabaseAdmin } from '../../config/supabase.js';
import { brainClient } from '../../brain/brain.client.js';
import type {
  AnswerLength,
  BrainAnswerRequest,
  BrainAnswerResponse,
  BrainHistoryItem,
} from '../../brain/brain.types.js';
import {
  DEFAULT_ANSWER_LENGTH,
  assistantChatCost,
  assistantFollowUpCost,
} from '../../utils/creditCosts.js';
import { deductCredits } from '../credits/credits.service.js';
import { NotFoundError } from '../../utils/errors.js';

/**
 * Mevzuat Asistanı (Opus 4.8 agentic) persistence + billing.
 *
 * Mirrors chat.service but targets the DEDICATED assistant_conversations /
 * assistant_messages tables (decision #6) so the new paid feature is fully
 * isolated from "Mevzuat Sohbet" (conversations/messages). Always paid; calls
 * the brain's /v2/assistant/answer.
 */

const MAX_HISTORY_TURNS = 6;
const TITLE_MAX = 80;

export interface AssistantPersistResult {
  conversationId: string;
  newBalance: number;
  message: {
    id: string;
    role: 'assistant';
    content: string;
    sources: BrainAnswerResponse['sources'];
    conflicts: BrainAnswerResponse['conflicts'];
    corpus_summaries: BrainAnswerResponse['corpus_summaries'] | null;
    confidence_score: number;
    trust_band?: string | null;
    trust_score?: number | null;
    trust_explanation?: string | null;
    not_found: boolean;
    credits_used: number;
    tokens_used: {
      prompt: number;
      completion: number;
      cost: BrainAnswerResponse['cost'];
    };
    cost_usd: number | null;
    answer_length: AnswerLength | null;
    created_at: string;
    brain_request_id: string | null;
    feedback_rating: number | null;
  };
}

function deriveTitle(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length <= TITLE_MAX) return trimmed;
  return trimmed.slice(0, TITLE_MAX - 1) + '…';
}

function tokensJsonb(answer: BrainAnswerResponse) {
  return {
    prompt: answer.tokens_used.prompt,
    completion: answer.tokens_used.completion,
    cost: answer.cost,
  };
}

/** Shape the persisted assistant message + merge the brain's in-memory trust signal. */
function shapeMessage(
  assistantMsg: Record<string, unknown>,
  answer: BrainAnswerResponse
): AssistantPersistResult['message'] {
  return {
    ...(assistantMsg as AssistantPersistResult['message']),
    trust_band: answer.trust_band ?? null,
    trust_score: answer.trust_score ?? null,
    trust_explanation: answer.trust_explanation ?? null,
  };
}

/** Start a new assistant conversation: call brain, deduct credits, persist conv + 2 messages. */
export async function startAssistantChat(args: {
  userId: string;
  query: string;
  filters?: { law_id?: string | null };
  answer_length?: AnswerLength;
  // Streaming path supplies the already-streamed answer so persistence/billing
  // is shared verbatim with the buffered path.
  precomputedAnswer?: BrainAnswerResponse;
}): Promise<AssistantPersistResult> {
  const length = args.answer_length ?? DEFAULT_ANSWER_LENGTH;

  const brainReq: BrainAnswerRequest = {
    query: args.query,
    filters: args.filters,
    answer_length: length,
  };
  const answer = args.precomputedAnswer ?? (await brainClient.assistantAnswer(brainReq));

  const cost = assistantChatCost(length);
  const { newBalance } = await deductCredits({
    userId: args.userId,
    amount: cost,
    type: 'chat',
    description: args.query.slice(0, 200),
    metadata: {
      tokens_used: answer.tokens_used,
      confidence: answer.confidence_score,
      cost: answer.cost,
      answer_length: length,
      engine: 'assistant',
    },
  });

  const { data: conv, error: convError } = await supabaseAdmin
    .from('assistant_conversations')
    .insert({
      user_id: args.userId,
      title: deriveTitle(args.query),
      initial_query: args.query,
      filters: args.filters ?? null,
      total_credits_used: cost,
    })
    .select('id')
    .single();
  if (convError || !conv) throw convError ?? new Error('Assistant conversation insert failed');

  await supabaseAdmin.from('assistant_messages').insert([
    { conversation_id: conv.id, role: 'user', content: args.query, credits_used: 0 },
  ]);

  const { data: assistantMsg, error: msgError } = await supabaseAdmin
    .from('assistant_messages')
    .insert({
      conversation_id: conv.id,
      role: 'assistant',
      content: answer.answer,
      sources: answer.sources,
      conflicts: answer.conflicts,
      corpus_summaries: answer.corpus_summaries,
      confidence_score: answer.confidence_score,
      not_found: answer.not_found,
      brain_request_id: answer.request_id ?? null,
      credits_used: cost,
      tokens_used: tokensJsonb(answer),
      cost_usd: answer.cost.total_usd,
      answer_length: length,
    })
    .select(
      'id, role, content, sources, conflicts, corpus_summaries, confidence_score, not_found, credits_used, tokens_used, cost_usd, answer_length, created_at, brain_request_id, feedback_rating'
    )
    .single();
  if (msgError || !assistantMsg) throw msgError ?? new Error('Assistant message insert failed');

  return {
    conversationId: conv.id,
    newBalance,
    message: shapeMessage(assistantMsg, answer),
  };
}

/** Follow-up: load history, call brain with history, deduct credits, persist 2 more messages. */
export async function followUpAssistant(args: {
  userId: string;
  conversationId: string;
  query: string;
  answer_length?: AnswerLength;
  precomputedAnswer?: BrainAnswerResponse;
}): Promise<AssistantPersistResult> {
  const length = args.answer_length ?? DEFAULT_ANSWER_LENGTH;

  const { data: conv, error: convError } = await supabaseAdmin
    .from('assistant_conversations')
    .select('id, user_id, filters, total_credits_used')
    .eq('id', args.conversationId)
    .is('deleted_at', null)
    .single();
  if (convError || !conv || conv.user_id !== args.userId) {
    throw new NotFoundError('Sohbet bulunamadı');
  }

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
  const answer = args.precomputedAnswer ?? (await brainClient.assistantAnswer(brainReq));

  const cost = assistantFollowUpCost(length);
  const { newBalance } = await deductCredits({
    userId: args.userId,
    amount: cost,
    type: 'follow_up',
    description: args.query.slice(0, 200),
    metadata: {
      conversationId: args.conversationId,
      tokens_used: answer.tokens_used,
      confidence: answer.confidence_score,
      cost: answer.cost,
      answer_length: length,
      engine: 'assistant',
    },
  });

  await supabaseAdmin.from('assistant_messages').insert([
    { conversation_id: args.conversationId, role: 'user', content: args.query, credits_used: 0 },
  ]);

  const { data: assistantMsg, error: msgError } = await supabaseAdmin
    .from('assistant_messages')
    .insert({
      conversation_id: args.conversationId,
      role: 'assistant',
      content: answer.answer,
      sources: answer.sources,
      conflicts: answer.conflicts,
      corpus_summaries: answer.corpus_summaries,
      confidence_score: answer.confidence_score,
      not_found: answer.not_found,
      brain_request_id: answer.request_id ?? null,
      credits_used: cost,
      tokens_used: tokensJsonb(answer),
      cost_usd: answer.cost.total_usd,
      answer_length: length,
    })
    .select(
      'id, role, content, sources, conflicts, corpus_summaries, confidence_score, not_found, credits_used, tokens_used, cost_usd, answer_length, created_at, brain_request_id, feedback_rating'
    )
    .single();
  if (msgError || !assistantMsg) throw msgError ?? new Error('Assistant message insert failed');

  await supabaseAdmin
    .from('assistant_conversations')
    .update({ total_credits_used: conv.total_credits_used + cost })
    .eq('id', args.conversationId);

  return {
    conversationId: args.conversationId,
    newBalance,
    message: shapeMessage(assistantMsg, answer),
  };
}

export async function listAssistantConversations(userId: string, limit = 50) {
  const { data, error } = await supabaseAdmin
    .from('assistant_conversations')
    .select('id, title, initial_query, total_credits_used, created_at, updated_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getAssistantConversation(userId: string, conversationId: string) {
  const { data: conv, error: convError } = await supabaseAdmin
    .from('assistant_conversations')
    .select('id, user_id, title, initial_query, filters, total_credits_used, created_at, updated_at')
    .eq('id', conversationId)
    .is('deleted_at', null)
    .single();
  if (convError || !conv || conv.user_id !== userId) {
    throw new NotFoundError('Sohbet bulunamadı');
  }
  const { data: messages, error: msgError } = await supabaseAdmin
    .from('assistant_messages')
    .select(
      'id, role, content, sources, conflicts, corpus_summaries, confidence_score, not_found, credits_used, tokens_used, cost_usd, answer_length, created_at, brain_request_id, feedback_rating'
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (msgError) throw msgError;

  return {
    conversation: {
      id: conv.id,
      title: conv.title,
      initial_query: conv.initial_query,
      filters: conv.filters,
      total_credits_used: conv.total_credits_used,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
    },
    messages: messages ?? [],
  };
}

export async function deleteAssistantConversation(userId: string, conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from('assistant_conversations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('user_id', userId)
    .select('id')
    .single();
  if (error || !data) throw new NotFoundError('Sohbet bulunamadı');
}
