import type { RequestHandler } from 'express';
import { AuthError } from '../../utils/errors.js';
import { SseWriter } from '../../utils/sse.js';
import { newAssistantChatSchema, assistantFollowUpSchema } from './assistant.schema.js';
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
    const conversations = await listAssistantConversations(req.user.id);
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
