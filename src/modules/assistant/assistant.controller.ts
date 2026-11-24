import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AuthError } from '../../utils/errors.js';
import { SseWriter } from '../../utils/sse.js';
import { runWithSubject } from '../../utils/requestContext.js';
import { newAssistantChatSchema, assistantFollowUpSchema } from './assistant.schema.js';
import { consumeStreamTicket, issueStreamTicket, STREAM_TICKET_TTL_MS } from './streamTicket.js';
import {
  deleteAssistantConversation,
  followUpAssistant,
  getAssistantConversation,
  listAssistantConversations,
  startAssistantChat,
} from './assistant.service.js';
import {
  streamAssistantChat,
  streamAssistantFollowUp,
} from './assistant.stream.service.js';

// ── Buffered ────────────────────────────────────────────────────────────────

export const createAssistantChat: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = newAssistantChatSchema.parse(req.body);
    const result = await startAssistantChat({
      userId: req.user.id,
      query: input.query,
      filters: input.filters,
      answer_length: input.answer_length,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const followUpAssistantChat: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { id } = req.params as { id: string };
    const input = assistantFollowUpSchema.parse(req.body);
    const result = await followUpAssistant({
      userId: req.user.id,
      conversationId: id,
      query: input.query,
      answer_length: input.answer_length,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// ── Streaming (SSE) ───────────────────────────────────────────────────────────
// Pre-flight errors (auth, balance) throw before any SSE header → JSON error via
// next(). Once streaming starts, the service surfaces failures as SSE `error`.

export const createAssistantChatStream: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = newAssistantChatSchema.parse(req.body);
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const sse = new SseWriter(res);
    await streamAssistantChat(
      {
        userId: req.user.id,
        query: input.query,
        filters: input.filters,
        answer_length: input.answer_length,
      },
      sse,
      ac.signal
    );
  } catch (err) {
    if (!res.headersSent) return next(err);
    if (!res.writableEnded) res.end();
  }
};

// EventSource variant of createAssistantChatStream. Browsers buffer fetch()
// ReadableStreams in some environments, delivering the whole SSE body only at
// the end; EventSource uses the native SSE engine and never buffers.
//
// EventSource cannot set an Authorization header or send a body, so the client
// first POSTs /conversations/stream-ticket (Bearer + JSON body) and opens the
// EventSource with only an opaque single-use `?ticket=`. The JWT and the user's
// question never appear in a URL (edge/proxy access logs record full URLs).
export const createAssistantStreamTicket: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = newAssistantChatSchema.parse(req.body);
    const ticket = issueStreamTicket({
      userId: req.user.id,
      query: input.query,
      filters: input.filters,
      answer_length: input.answer_length,
    });
    res.status(201).json({ ticket, expires_in: STREAM_TICKET_TTL_MS / 1000 });
  } catch (err) {
    next(err);
  }
};

const assistantStreamQuerySchema = z.object({
  ticket: z.string().min(20).max(200),
});

export const createAssistantChatStreamGET: RequestHandler = async (req, res, next) => {
  try {
    const q = assistantStreamQuerySchema.parse(req.query);
    const payload = consumeStreamTicket(q.ticket);
    if (!payload) throw new AuthError('Geçersiz veya süresi dolmuş akış bileti');

    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const sse = new SseWriter(res);
    // This route runs before requireAuth (ticket auth), so establish the
    // request's data subject here for the brain's X-Subject-Id header.
    await runWithSubject(payload.userId, () => streamAssistantChat(payload, sse, ac.signal));
  } catch (err) {
    if (!res.headersSent) return next(err);
    if (!res.writableEnded) res.end();
  }
};

export const followUpAssistantChatStream: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { id } = req.params as { id: string };
    const input = assistantFollowUpSchema.parse(req.body);
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const sse = new SseWriter(res);
    await streamAssistantFollowUp(
      {
        userId: req.user.id,
        conversationId: id,
        query: input.query,
        answer_length: input.answer_length,
      },
      sse,
      ac.signal
    );
  } catch (err) {
    if (!res.headersSent) return next(err);
    if (!res.writableEnded) res.end();
  }
};

// ── Conversation management ───────────────────────────────────────────────────

export const listAssistant: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    // Optional ?limit for the Geçmiş page (paginated conversation history);
    // the sidebar calls without it and keeps the 50-row default. Capped at 200.
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const conversations = await listAssistantConversations(req.user.id, limit);
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
};

export const getAssistant: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { id } = req.params as { id: string };
    const result = await getAssistantConversation(req.user.id, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const deleteAssistant: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { id } = req.params as { id: string };
    await deleteAssistantConversation(req.user.id, id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
