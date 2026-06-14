import { supabaseAdmin } from '../../config/supabase.js';
import { brainClient } from '../../brain/brain.client.js';
import type {
  AnswerLength,
  BrainAnswerRequest,
  BrainAnswerResponse,
  BrainHistoryItem,
} from '../../brain/brain.types.js';
import {
  CREDIT_COSTS,
  DEFAULT_ANSWER_LENGTH,
  chatCost,
  followUpCost,
  v2ChatCost,
} from '../../utils/creditCosts.js';
import { deductCredits } from '../credits/credits.service.js';
import { NotFoundError } from '../../utils/errors.js';

const MAX_HISTORY_TURNS = 6;
const TITLE_MAX = 80;

export type ChatEngine = 'v1' | 'v2';

interface PersistedMessage {
  conversationId: string;
  newBalance: number;
  message: {
    id: string;
    role: 'assistant';
    content: string;
    sources: BrainAnswerResponse['sources'];
    conflicts: BrainAnswerResponse['conflicts'];
    confidence_score: number;
    not_found: boolean;
    credits_used: number;
    tokens_used: {
      prompt: number;
      completion: number;
      cost: BrainAnswerResponse['cost'];
    };
    cost_usd: number | null;
    answer_length: AnswerLength | null;
    engine: ChatEngine;
    created_at: string;
    brain_request_id: string | null;
    feedback_rating: number | null;
  };
}

// V1 follows the answer-length-tiered CREDIT_COSTS table.
// V2 is a flat per-question cost regardless of length or kind (start/follow-up).
function priceFor(engine: ChatEngine, kind: 'start' | 'follow', length: AnswerLength): number {
  if (engine === 'v2') return v2ChatCost();
  return kind === 'start' ? chatCost(length) : followUpCost(length);
}

/**
 * Start a new conversation: call brain, deduct credits, persist conv + 2 messages (user + assistant).
 * `engine` selects the V1 (credit-billed) vs V2 (free demo) path.
 */
export async function startConversation(args: {
  userId: string;
  query: string;
  filters?: { law_id?: string | null };
  answer_length?: AnswerLength;
  engine?: ChatEngine;
}): Promise<PersistedMessage> {
  const length = args.answer_length ?? DEFAULT_ANSWER_LENGTH;
  const engine: ChatEngine = args.engine ?? 'v1';

  const brainReq: BrainAnswerRequest = {
    query: args.query,
    filters: args.filters,
    answer_length: length,
  };
  const answer = engine === 'v2'
    ? await brainClient.answerV2(brainReq)
    : await brainClient.answer(brainReq);

  const cost = priceFor(engine, 'start', length);
  const billingType = engine === 'v2' ? 'v2_chat' : 'chat';

  // V2 demo is free — skip the credit ledger entirely (cost = 0). For V1 the
  // deductCredits call also enforces sufficient balance, which we want to keep.
  let newBalance = 0;
  if (cost > 0) {
    const res = await deductCredits({
      userId: args.userId,
      amount: cost,
      type: 'chat',
      description: args.query.slice(0, 200),
      metadata: {
        tokens_used: answer.tokens_used,
        confidence: answer.confidence_score,
        cost: answer.cost,
        answer_length: length,
        engine,
      },
    });
    newBalance = res.newBalance;
  } else {
    // Read current balance for response shape parity.
    const { data: u } = await supabaseAdmin
      .from('users').select('credits').eq('id', args.userId).single();
    newBalance = u?.credits ?? 0;
  }

  const title = deriveTitle(args.query);

  const { data: conv, error: convError } = await supabaseAdmin
    .from('conversations')
    .insert({
      user_id: args.userId,
      title,
      initial_query: args.query,
      filters: args.filters ?? null,
      total_credits_used: cost,
      engine,
    })
    .select('id')
    .single();
  if (convError || !conv) throw convError ?? new Error('Conversation insert failed');

  await supabaseAdmin.from('messages').insert([
    {
      conversation_id: conv.id,
      role: 'user',
      content: args.query,
      credits_used: 0,
      engine,
    },
  ]);

  const tokensUsedJsonb = {
    prompt: answer.tokens_used.prompt,
    completion: answer.tokens_used.completion,
    cost: answer.cost,
  };

  const { data: assistantMsg, error: msgError } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: conv.id,
      role: 'assistant',
      content: answer.answer,
      sources: answer.sources,
      conflicts: answer.conflicts,
      confidence_score: answer.confidence_score,
      not_found: answer.not_found,
      brain_request_id: answer.request_id ?? null,
      credits_used: cost,
      tokens_used: tokensUsedJsonb,
      cost_usd: answer.cost.total_usd,
      answer_length: length,
      engine,
    })
    .select(
      'id, role, content, sources, conflicts, confidence_score, not_found, credits_used, tokens_used, cost_usd, answer_length, engine, created_at, brain_request_id, feedback_rating'
    )
    .single();
  if (msgError || !assistantMsg) throw msgError ?? new Error('Message insert failed');

  await supabaseAdmin.from('search_history').insert({
    user_id: args.userId,
    query: args.query,
    search_type: billingType,
    filters: args.filters ?? null,
    results_count: answer.sources.length,
  });

  return {
    conversationId: conv.id,
    newBalance,
    message: assistantMsg,
  };
}

/**
 * Follow-up: load history, call brain with history, deduct credits, persist 2 more messages.
 * Engine is read from the conversation row — can't switch engines mid-thread.
 */
export async function followUp(args: {
  userId: string;
  conversationId: string;
  query: string;
  answer_length?: AnswerLength;
  expectedEngine?: ChatEngine;
}): Promise<PersistedMessage> {
  const length = args.answer_length ?? DEFAULT_ANSWER_LENGTH;

  const { data: conv, error: convError } = await supabaseAdmin
    .from('conversations')
    .select('id, user_id, filters, total_credits_used, engine')
    .eq('id', args.conversationId)
    .is('deleted_at', null)
    .single();
  if (convError || !conv || conv.user_id !== args.userId) {
    throw new NotFoundError('Sohbet bulunamadı');
  }
  const engine: ChatEngine = (conv.engine as ChatEngine | null) ?? 'v1';
  // Defensive: if controller declared which engine it expects (V1 chat route
  // vs V2 demo route), reject cross-engine writes so a V2 demo conversation
  // can't be billed via the V1 follow-up endpoint and vice versa.
  if (args.expectedEngine && args.expectedEngine !== engine) {
    throw new NotFoundError('Sohbet bulunamadı');
  }

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
  const answer = engine === 'v2'
    ? await brainClient.answerV2(brainReq)
    : await brainClient.answer(brainReq);

  const cost = priceFor(engine, 'follow', length);
  const billingType = engine === 'v2' ? 'v2_chat' : 'chat';

  let newBalance = 0;
  if (cost > 0) {
    const res = await deductCredits({
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
        engine,
      },
    });
    newBalance = res.newBalance;
  } else {
    const { data: u } = await supabaseAdmin
      .from('users').select('credits').eq('id', args.userId).single();
    newBalance = u?.credits ?? 0;
  }

  await supabaseAdmin.from('messages').insert([
    {
      conversation_id: args.conversationId,
      role: 'user',
      content: args.query,
      credits_used: 0,
      engine,
    },
  ]);

  const tokensUsedJsonb = {
    prompt: answer.tokens_used.prompt,
    completion: answer.tokens_used.completion,
    cost: answer.cost,
  };

  const { data: assistantMsg, error: msgError } = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: args.conversationId,
      role: 'assistant',
      content: answer.answer,
      sources: answer.sources,
      conflicts: answer.conflicts,
      confidence_score: answer.confidence_score,
      not_found: answer.not_found,
      brain_request_id: answer.request_id ?? null,
      credits_used: cost,
      tokens_used: tokensUsedJsonb,
      cost_usd: answer.cost.total_usd,
      answer_length: length,
      engine,
    })
    .select(
      'id, role, content, sources, conflicts, confidence_score, not_found, credits_used, tokens_used, cost_usd, answer_length, engine, created_at, brain_request_id, feedback_rating'
    )
    .single();
  if (msgError || !assistantMsg) throw msgError ?? new Error('Message insert failed');

  await supabaseAdmin
    .from('conversations')
    .update({ total_credits_used: conv.total_credits_used + cost })
    .eq('id', args.conversationId);

  await supabaseAdmin.from('search_history').insert({
    user_id: args.userId,
    query: args.query,
    search_type: billingType,
    filters: conv.filters ?? null,
    results_count: answer.sources.length,
  });

  return {
    conversationId: args.conversationId,
    newBalance,
    message: assistantMsg,
  };
}

export async function listConversations(userId: string, limit = 50) {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id, title, initial_query, total_credits_used, engine, created_at, updated_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getConversation(userId: string, conversationId: string) {
  const { data: conv, error: convError } = await supabaseAdmin
    .from('conversations')
    .select('id, user_id, title, initial_query, filters, total_credits_used, engine, created_at, updated_at')
    .eq('id', conversationId)
    .is('deleted_at', null)
    .single();
  if (convError || !conv || conv.user_id !== userId) {
    throw new NotFoundError('Sohbet bulunamadı');
  }
  const { data: messages, error: msgError } = await supabaseAdmin
    .from('messages')
    .select(
      'id, role, content, sources, conflicts, confidence_score, not_found, credits_used, tokens_used, cost_usd, answer_length, engine, created_at, brain_request_id, feedback_rating'
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
      engine: (conv.engine ?? 'v1') as ChatEngine,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
    },
    messages: messages ?? [],
  };
}

export async function deleteConversation(userId: string, conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', conversationId)
    .eq('user_id', userId)
    .select('id')
    .single();
  if (error || !data) throw new NotFoundError('Sohbet bulunamadı');
}

function deriveTitle(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length <= TITLE_MAX) return trimmed;
  return trimmed.slice(0, TITLE_MAX - 1) + '…';
}

// Re-export so older callers that imported CREDIT_COSTS still work.
export { CREDIT_COSTS };
