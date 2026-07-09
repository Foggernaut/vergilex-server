import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.js';
import { mailLimiter } from '../../middleware/rateLimit.js';
import { emailAnswerPdf } from './export.controller.js';

// PDF eki en fazla 5MB. Bellek depolama — buffer doğrudan Resend'e iletilir.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

export const exportRouter = Router();

// İndirme tamamen client-side; sunucu yalnız e-posta gönderir → normal Bearer auth.
exportRouter.use(requireAuth);

exportRouter.post('/email', mailLimiter, upload.single('pdf'), emailAnswerPdf);
