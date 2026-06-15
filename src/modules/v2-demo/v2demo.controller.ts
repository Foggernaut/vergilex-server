import type { RequestHandler } from 'express';
import { z } from 'zod';
import { brainClient } from '../../brain/brain.client.js';
import { AppError, AuthError } from '../../utils/errors.js';
import { followUp, recordSearchHistory, startConversation } from '../chat/chat.service.js';
import { streamConversation, streamFollowUp } from '../chat/chat.stream.service.js';
import { SseWriter } from '../../utils/sse.js';

const newV2ChatSchema = z.object({
  query: z.string().min(2).max(1000),
  filters: z.object({ law_id: z.string().nullable().optional() }).optional(),
  answer_length: z.enum(['short', 'medium', 'long']).optional(),
});

const v2FollowUpSchema = z.object({
  query: z.string().min(2).max(1000),
  answer_length: z.enum(['short', 'medium', 'long']).optional(),
});

const ALLOWED_MIME = new Set([
  'application/pdf',
  'text/plain',
]);

export const createV2Chat: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = newV2ChatSchema.parse(req.body);
    const result = await startConversation({
      userId: req.user.id,
      query: input.query,
      filters: input.filters,
      answer_length: input.answer_length,
      engine: 'v2',
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const followUpV2Chat: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { id } = req.params as { id: string };
    const input = v2FollowUpSchema.parse(req.body);
    const result = await followUp({
      userId: req.user.id,
      conversationId: id,
      query: input.query,
      answer_length: input.answer_length,
      expectedEngine: 'v2',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

/**
 * SSE streaming variant of createV2Chat. Pre-flight errors (auth, balance) are
 * thrown before any SSE header is written → normal JSON error via next(). Once
 * streaming starts, the service surfaces failures as SSE `error` frames.
 */
export const createV2ChatStream: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const input = newV2ChatSchema.parse(req.body);
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const sse = new SseWriter(res);
    await streamConversation(
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
    // Streaming already began — the service emitted an SSE error + closed.
    if (!res.writableEnded) res.end();
  }
};

export const followUpV2ChatStream: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const { id } = req.params as { id: string };
    const input = v2FollowUpSchema.parse(req.body);
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const sse = new SseWriter(res);
    await streamFollowUp(
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

export const analyzeDocument: RequestHandler = async (req, res, next) => {
  try {
    if (!req.user) throw new AuthError();
    const file = (req as { file?: Express.Multer.File }).file;
    if (!file) {
      throw new AppError(400, 'NO_FILE', 'Dosya yüklenmedi');
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new AppError(
        400,
        'UNSUPPORTED_MIME',
        'Sadece PDF veya düz metin dosyaları desteklenir'
      );
    }
    const query = typeof req.body?.query === 'string' ? req.body.query.slice(0, 1000) : undefined;

    const result = await brainClient.analyzeDocument({
      file: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      query,
    });

    // Record the analysis in search_history so it shows up in Geçmiş.
    // The "query" column gets the filename; results_count = detected concept count.
    // Non-fatal + logged (see recordSearchHistory) so a constraint/RLS failure
    // never silently drops the Geçmiş row.
    await recordSearchHistory({
      user_id: req.user.id,
      query: file.originalname.slice(0, 200),
      search_type: 'v2_analyze',
      filters: null,
      results_count: result.detected_concepts.length,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};
