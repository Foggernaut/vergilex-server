import { supabaseAdmin } from '../../config/supabase.js';
import { brainClient } from '../../brain/brain.client.js';
import type {
  BrainAnswerRequest,
  BrainAnswerResponse,
  BrainHistoryItem,
} from '../../brain/brain.types.js';
import { CREDIT_COSTS } from '../../utils/creditCosts.js';
import { deductCredits } from '../credits/credits.service.js';
import { NotFoundError } from '../../utils/errors.js';

const MAX_HISTORY_TURNS = 6;
const TITLE_MAX = 80;

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
    tokens_used: BrainAnswerResponse['tokens_used'];
    created_at: string;
  };
}

/**
 * Start a new conversation: call brain, deduct credits, persist conv + 2 messages (user + assistant).
 */
export async function startConversation(args: {
  userId: string;
  query: string;
  filters?: { law_id?: string | null };
}): Promise<PersistedMessage> {
  const brainReq: BrainAnswerRequest = {
    query: args.query,
    filters: args.filters,
  };
  const answer = await brainClient.answer(brainReq);

  const cost = CREDIT_COSTS.chat;
  const { newBalance } = await deductCredits({
    userId: args.userId,
    amount: cost,
    type: 'chat',
    description: args.query.slice(0, 200),
    metadata: {
      tokens_used: answer.tokens_used,
      confidence: answer.confidence_score,
    },
  });

  const title = deriveTitle(args.query);

  const { data: conv, error: convError } = await supabaseAdmin
    .from('conversations')
    .insert({
      user_id: args.userId,
      title,
      initial_query: args.query,
      filters: args.filters ?? null,
      total_credits_used: cost,
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
    },
  ]);

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
      credits_used: cost,
      tokens_used: answer.tokens_used,
    })
    .select('id, role, content, sources, conflicts, confidence_score, not_found, credits_used, tokens_used, created_at')
    .single();
  if (msgError || !assistantMsg) throw msgError ?? new Error('Message insert failed');

  // search_history
  await supabaseAdmin.from('search_history').insert({
    user_id: args.userId,
    query: args.query,
    search_type: 'chat',
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
 */
export async function followUp(args: {
  userId: string;
  conversationId: string;
  query: string;
}): Promise<PersistedMessage> {
  // Verify conversation belongs to user
  const { data: conv, error: convError } = await supabaseAdmin
    .from('conversations')
    .select('id, user_id, filters, total_credits_used')
    .eq('id', args.conversationId)
    .is('deleted_at', null)
    .single();
  if (convError || !conv || conv.user_id !== args.userId) {
    throw new NotFoundError('Sohbet bulunamadı');
  }

  // Load last N turns
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

  const answer = await brainClient.answer({
    query: args.query,
    filters: (conv.filters ?? undefined) as { law_id?: string | null } | undefined,
    history,
  });

  const cost = CREDIT_COSTS.follow_up;
  const { newBalance } = await deductCredits({
    userId: args.userId,
    amount: cost,
    type: 'follow_up',
    description: args.query.slice(0, 200),
    metadata: {
      conversationId: args.conversationId,
      tokens_used: answer.tokens_used,
      confidence: answer.confidence_score,
    },
  });

  await supabaseAdmin.from('messages').insert([
    {
      conversation_id: args.conversationId,
      role: 'user',
      content: args.query,
      credits_used: 0,
    },
  ]);

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
      credits_used: cost,
      tokens_used: answer.tokens_used,
    })
    .select('id, role, content, sources, conflicts, confidence_score, not_found, credits_used, tokens_used, created_at')
    .single();
  if (msgError || !assistantMsg) throw msgError ?? new Error('Message insert failed');

  await supabaseAdmin
    .from('conversations')
    .update({ total_credits_used: conv.total_credits_used + cost })
    .eq('id', args.conversationId);

  await supabaseAdmin.from('search_history').insert({
    user_id: args.userId,
    query: args.query,
    search_type: 'chat',
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
    .select('id, title, initial_query, total_credits_used, created_at, updated_at')
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
    .select('id, user_id, title, initial_query, filters, total_credits_used, created_at, updated_at')
    .eq('id', conversationId)
    .is('deleted_at', null)
    .single();
  if (convError || !conv || conv.user_id !== userId) {
    throw new NotFoundError('Sohbet bulunamadı');
  }
  const { data: messages, error: msgError } = await supabaseAdmin
    .from('messages')
    .select('id, role, content, sources, conflicts, confidence_score, not_found, credits_used, tokens_used, created_at')
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
