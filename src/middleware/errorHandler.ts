import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { BrainError } from '../brain/brain.errors.js';
import { logger } from '../config/logger.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Dosya boyutu 10MB sınırını aşıyor'
        : 'Dosya yüklenemedi';
    res.status(400).json({ error: { code: err.code, message } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Geçersiz istek', details: err.flatten() },
    });
    return;
  }

  if (err instanceof BrainError) {
    logger.error('Brain error', { code: err.code, status: err.status, message: err.message });
    res.status(err.status).json({
      error: { code: err.code, message: err.userMessage },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  logger.error('Unhandled error', { err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Beklenmeyen bir hata oluştu' },
  });
};
