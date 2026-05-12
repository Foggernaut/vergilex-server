import { request } from 'undici';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  BrainAuthError,
  BrainError,
  BrainSchemaError,
  BrainTimeoutError,
  BrainUnavailableError,
  BrainValidationError,
} from './brain.errors.js';
import {
  type BrainAnswerRequest,
  type BrainAnswerResponse,
  BrainAnswerResponseSchema,
  type BrainFindDocumentsRequest,
  type BrainFindDocumentsResponse,
  BrainFindDocumentsResponseSchema,
} from './brain.types.js';
import { z } from 'zod';

interface CircuitBreakerState {
  failures: number;
  openUntil: number; // epoch ms; 0 = closed
}

const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 30_000;
const RETRY_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;

const HealthSchema = z.object({ status: z.string() }).passthrough();

export class BrainClient {
  private breaker: CircuitBreakerState = { failures: 0, openUntil: 0 };

  constructor(
    private readonly cfg: {
      baseUrl: string;
      apiKey: string;
      timeoutMs: number;
    }
  ) {}

  async findDocuments(req: BrainFindDocumentsRequest): Promise<BrainFindDocumentsResponse> {
    return this.post('/find-documents', req, BrainFindDocumentsResponseSchema);
  }

  async answer(req: BrainAnswerRequest): Promise<BrainAnswerResponse> {
    return this.post('/answer-questions', req, BrainAnswerResponseSchema);
  }

  async health(): Promise<{ status: string }> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/health`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await request(url, { method: 'GET', signal: ctrl.signal });
      const body = (await res.body.json()) as unknown;
      return HealthSchema.parse(body);
    } finally {
      clearTimeout(t);
    }
  }

  private async post<T>(
    path: string,
    body: unknown,
    responseSchema: z.ZodSchema<T>
  ): Promise<T> {
    this.checkBreaker();

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.doRequest(path, body, responseSchema);
        this.recordSuccess();
        return result;
      } catch (err) {
        lastError = err;
        if (err instanceof BrainError && !this.isRetriable(err)) {
          this.recordFailure();
          throw err;
        }
        if (attempt < MAX_RETRIES) {
          await delay(2 ** attempt * 500);
          continue;
        }
      }
    }
    this.recordFailure();
    if (lastError instanceof BrainError) throw lastError;
    throw new BrainUnavailableError(lastError);
  }

  private async doRequest<T>(
    path: string,
    body: unknown,
    responseSchema: z.ZodSchema<T>
  ): Promise<T> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}${path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    const started = Date.now();
    logger.info('Brain request →', { url, timeoutMs: this.cfg.timeoutMs });

    let res;
    try {
      res = await request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.cfg.apiKey,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err: unknown) {
      const error = err as { name?: string; code?: string; message?: string };
      logger.error('Brain request failed (network)', {
        url,
        name: error?.name,
        code: error?.code,
        message: error?.message,
        durationMs: Date.now() - started,
      });
      if (error?.name === 'AbortError') {
        throw new BrainTimeoutError(err);
      }
      throw new BrainUnavailableError(err);
    } finally {
      clearTimeout(t);
    }

    const status = res.statusCode;
    logger.info('Brain response ←', { url, status, durationMs: Date.now() - started });

    if (status === 403 || status === 401) {
      throw new BrainAuthError();
    }
    if (status === 400 || status === 422) {
      let details: unknown;
      try {
        details = await res.body.json();
      } catch {
        /* noop */
      }
      throw new BrainValidationError(details);
    }
    if (status >= 500 || status === 429) {
      throw new BrainUnavailableError({ status });
    }
    if (status < 200 || status >= 300) {
      throw new BrainUnavailableError({ status });
    }

    let raw: unknown;
    try {
      raw = await res.body.json();
    } catch (err) {
      throw new BrainSchemaError(err);
    }

    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error('Brain response schema mismatch', {
        path,
        issues: parsed.error.flatten(),
      });
      throw new BrainSchemaError(parsed.error);
    }
    return parsed.data;
  }

  private isRetriable(err: BrainError): boolean {
    return err.status === 504 || err.status === 503 || RETRY_STATUSES.has(err.status);
  }

  private checkBreaker(): void {
    if (this.breaker.openUntil > Date.now()) {
      throw new BrainUnavailableError({ reason: 'circuit breaker open' });
    }
  }

  private recordSuccess(): void {
    this.breaker.failures = 0;
    this.breaker.openUntil = 0;
  }

  private recordFailure(): void {
    this.breaker.failures += 1;
    if (this.breaker.failures >= FAILURE_THRESHOLD) {
      this.breaker.openUntil = Date.now() + OPEN_DURATION_MS;
      this.breaker.failures = 0;
      logger.warn('Brain circuit breaker opened', { openUntil: this.breaker.openUntil });
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singleton
export const brainClient = new BrainClient({
  baseUrl: env.BRAIN_API_URL,
  apiKey: env.BRAIN_API_KEY,
  timeoutMs: env.BRAIN_TIMEOUT_MS,
});
