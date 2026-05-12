import type { RequestHandler } from 'express';
import { AuthError } from '../../utils/errors.js';
import { followUpSchema, newChatSchema } from './chat.schema.js';
import {
  deleteConversation,
  followUp,
  getConversation,
  listConversations,
  startConversation,
} from './chat.service.js';

export const createChat: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = newChatSchema.parse(req.body);
    const result = await startConversation({
      userId: req.user.id,
      query: input.query,
      filters: input.filters,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const followUpChat: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { id } = req.params as { id: string };
    const input = followUpSchema.parse(req.body);
    const result = await followUp({
      userId: req.user.id,
      conversationId: id,
      query: input.query,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const listChats: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const items = await listConversations(req.user.id);
    res.json({ conversations: items });
  } catch (err) {
    next(err);
  }
};

export const getChat: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { id } = req.params as { id: string };
    const result = await getConversation(req.user.id, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const deleteChat: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { id } = req.params as { id: string };
    await deleteConversation(req.user.id, id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
