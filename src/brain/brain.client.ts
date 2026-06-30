import { FormData, request } from 'undici';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  BrainAuthError,
  BrainError,
  BrainSchemaError,
  BrainStreamUnsupportedError,
  BrainTimeoutError,
  BrainUnavailableError,
  BrainValidationError,
} from './brain.errors.js';
import {
  type BrainAnalyzeDocumentResponse,
  BrainAnalyzeDocumentResponseSchema,
  type BrainAnswerRequest,
  type BrainAnswerResponse,
  BrainAnswerResponseSchema,
  type BrainFeedbackRequest,
  type BrainFeedbackResponse,
  BrainFeedbackResponseSchema,
  type BrainFindDocumentsRequest,
  type BrainFindDocumentsResponse,
  BrainFindDocumentsResponseSchema,
  type BrainDocumentResult,
  type BrainStreamEvent,
} from './brain.types.js';
import { z } from 'zod';

interface CircuitBreakerState {
  failures: number;
  openUntil: number; // epoch ms; 0 = closed
}

const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 30_000;
const RETRY_STATUSES = new Set([502, 503, 504]);
// Retry disabled: brain V2 pipeline can take 100-150s with the agent path.
// A retry here would issue a fresh brain request (no idempotency on brain
// side), creating duplicate audit entries and triple-billing the LLM calls.
const MAX_RETRIES = 0;

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

  // --- v2 opt-in endpoints (Agentic RAG) ---

  async answerV2(req: BrainAnswerRequest): Promise<BrainAnswerResponse> {
    return this.post('/v2/answer-questions', req, BrainAnswerResponseSchema);
  }

  async findDocumentsV2(req: BrainFindDocumentsRequest): Promise<BrainFindDocumentsResponse> {
    return this.post('/v2/find-documents', req, BrainFindDocumentsResponseSchema);
  }

  /**
   * Streaming variant of answerV2. Consumes the brain's SSE response without
   * buffering and yields parsed events (phase / answer_delta / complete / error).
   * `signal` is wired to the client (browser) connection so a disconnect aborts
   * the upstream brain request. Throws BrainStreamUnsupportedError on 404 so the
   * caller can fall back to the buffered answerV2.
   *
   * NB: intentionally bypasses the circuit breaker + retry wrapper — a long-lived
   * SSE stream has different failure semantics than a buffered POST, and the
   * heartbeat keeps the socket alive so undici's body-inactivity timeout never fires.
   */
  async *answerV2Stream(
    req: BrainAnswerRequest,
    signal?: AbortSignal
  ): AsyncGenerator<BrainStreamEvent> {
    yield* this.streamAnswer('/v2/answer-questions/stream', req, signal);
  }

  // --- Mevzuat Asistanı (Opus 4.8 agentic) — same request/response contract ---

  async assistantAnswer(req: BrainAnswerRequest): Promise<BrainAnswerResponse> {
    return this.post('/v2/assistant/answer', req, BrainAnswerResponseSchema);
  }

  /** Streaming variant of assistantAnswer. Same SSE event shape as answerV2Stream. */
  async *assistantAnswerStream(
    req: BrainAnswerRequest,
    signal?: AbortSignal
  ): AsyncGenerator<BrainStreamEvent> {
    yield* this.streamAnswer('/v2/assistant/answer/stream', req, signal);
  }

  /**
   * Shared SSE consumer for the brain's streaming answer endpoints. Yields
   * parsed events (phase / answer_delta / complete / error) without buffering;
   * `signal` aborts the upstream request on client disconnect. Throws
   * BrainStreamUnsupportedError on 404/405 so the caller can fall back to buffered.
   */
  private async *streamAnswer(
    path: string,
    req: BrainAnswerRequest,
    signal?: AbortSignal
  ): AsyncGenerator<BrainStreamEvent> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}${path}`;
    const started = Date.now();
    logger.info('Brain stream request →', { url });

    let res;
    try {
      res = await request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'x-api-key': this.cfg.apiKey,
        },
        body: JSON.stringify(req),
        signal,
      });
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error?.name === 'AbortError') throw new BrainTimeoutError(err);
      throw new BrainUnavailableError(err);
    }

    const status = res.statusCode;
    logger.info('Brain stream response ←', { url, status, durationMs: Date.now() - started });
    if (status === 404 || status === 405) {
      res.body.dump().catch(() => {});
      throw new BrainStreamUnsupportedError();
    }
    if (status === 403 || status === 401) throw new BrainAuthError();
    if (status === 400 || status === 422) throw new BrainValidationError();
    if (status < 200 || status >= 300) throw new BrainUnavailableError({ status });

    // SSE frame parser: events separated by a blank line; each event has an
    // `event:` type and one or more `data:` lines. Lines starting with ':' are
    // heartbeat comments and are ignored.
    let buffer = '';
    try {
      for await (const chunk of res.body) {
        buffer += chunk.toString('utf8').replace(/\r\n/g, '\n');
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const ev = this.parseSseFrame(frame);
          if (ev) yield ev;
        }
      }
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error?.name === 'AbortError') throw new BrainTimeoutError(err);
      throw new BrainUnavailableError(err);
    }
  }

  private parseSseFrame(frame: string): BrainStreamEvent | null {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue; // heartbeat / comment
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return null;
    const raw = dataLines.join('\n');
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    const obj = data as Record<string, unknown>;
    switch (event) {
      case 'phase':
        return { type: 'phase', phase: String(obj.phase ?? '') };
      case 'answer_delta':
        return { type: 'answer_delta', text: String(obj.text ?? '') };
      case 'layer1':
        return { type: 'layer1', documents: (obj.documents ?? []) as BrainDocumentResult[] };
      case 'layer2':
        return {
          type: 'layer2',
          corpus: String(obj.corpus ?? ''),
          label: String(obj.label ?? ''),
          summary: String(obj.summary ?? ''),
        };
      case 'layer3_delta':
        return { type: 'layer3_delta', text: String(obj.text ?? '') };
      case 'error':
        return {
          type: 'error',
          code: String(obj.code ?? 'BRAIN_ERROR'),
          message: String(obj.message ?? ''),
        };
      case 'complete': {
        const parsed = BrainAnswerResponseSchema.safeParse(data);
        if (!parsed.success) {
          logger.error('Brain stream complete schema mismatch', {
            issues: parsed.error.flatten(),
          });
          throw new BrainSchemaError(parsed.error);
        }
        return { type: 'complete', response: parsed.data };
      }
      default:
        return null;
    }
  }

  async submitFeedback(req: BrainFeedbackRequest): Promise<BrainFeedbackResponse> {
    return this.post('/v2/feedback', req, BrainFeedbackResponseSchema);
  }

  async analyzeDocument(input: {
    file: Buffer;
    filename: string;
    mimeType: string;
    query?: string;
  }): Promise<BrainAnalyzeDocumentResponse> {
    return this.postMultipart('/v2/analyze-document', input, BrainAnalyzeDocumentResponseSchema);
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

  private async post<S extends z.ZodTypeAny>(
    path: string,
    body: unknown,
    responseSchema: S
  ): Promise<z.output<S>> {
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

  private async doRequest<S extends z.ZodTypeAny>(
    path: string,
    body: unknown,
    responseSchema: S
  ): Promise<z.output<S>> {
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

  private async postMultipart<S extends z.ZodTypeAny>(
    path: string,
    input: { file: Buffer; filename: string; mimeType: string; query?: string },
    responseSchema: S
  ): Promise<z.output<S>> {
    this.checkBreaker();

    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}${path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    const started = Date.now();
    logger.info('Brain multipart request →', {
      url,
      filename: input.filename,
      size: input.file.byteLength,
      timeoutMs: this.cfg.timeoutMs,
    });

    let res;
    try {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(input.file)], { type: input.mimeType });
      form.append('file', blob, input.filename);
      if (input.query) form.append('query', input.query);

      res = await request(url, {
        method: 'POST',
        headers: { 'x-api-key': this.cfg.apiKey },
        body: form,
        signal: ctrl.signal,
      });
    } catch (err: unknown) {
      const error = err as { name?: string; code?: string; message?: string };
      logger.error('Brain multipart request failed (network)', {
        url,
        name: error?.name,
        code: error?.code,
        message: error?.message,
        durationMs: Date.now() - started,
      });
      this.recordFailure();
      if (error?.name === 'AbortError') throw new BrainTimeoutError(err);
      throw new BrainUnavailableError(err);
    } finally {
      clearTimeout(t);
    }

    const status = res.statusCode;
    logger.info('Brain multipart response ←', { url, status, durationMs: Date.now() - started });

    if (status === 403 || status === 401) {
      this.recordFailure();
      throw new BrainAuthError();
    }
    if (status === 400 || status === 422) {
      let details: unknown;
      try {
        details = await res.body.json();
      } catch {
        /* noop */
      }
      this.recordFailure();
      throw new BrainValidationError(details);
    }
    if (status >= 500 || status === 429) {
      this.recordFailure();
      throw new BrainUnavailableError({ status });
    }
    if (status < 200 || status >= 300) {
      this.recordFailure();
      throw new BrainUnavailableError({ status });
    }

    let raw: unknown;
    try {
      raw = await res.body.json();
    } catch (err) {
      this.recordFailure();
      throw new BrainSchemaError(err);
    }

    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error('Brain multipart response schema mismatch', {
        path,
        issues: parsed.error.flatten(),
      });
      this.recordFailure();
      throw new BrainSchemaError(parsed.error);
    }
    this.recordSuccess();
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
