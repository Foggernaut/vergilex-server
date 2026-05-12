// All brain-related errors with status + user-facing Turkish message.
export class BrainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly userMessage: string,
    message?: string,
    public readonly cause?: unknown
  ) {
    super(message ?? userMessage);
    this.name = 'BrainError';
  }
}

export class BrainTimeoutError extends BrainError {
  constructor(cause?: unknown) {
    super(504, 'BRAIN_TIMEOUT', 'Servis yanıt vermedi, lütfen tekrar deneyin', 'Brain request timed out', cause);
  }
}

export class BrainUnavailableError extends BrainError {
  constructor(cause?: unknown) {
    super(503, 'BRAIN_UNAVAILABLE', 'Servis şu anda kullanılamıyor', 'Brain unavailable', cause);
  }
}

export class BrainAuthError extends BrainError {
  constructor() {
    // 500 not 401 — this is our config problem, not the user's.
    super(500, 'BRAIN_AUTH_MISCONFIGURED', 'Beklenmeyen bir hata oluştu', 'Brain API key rejected');
  }
}

export class BrainValidationError extends BrainError {
  constructor(details?: unknown) {
    super(400, 'BRAIN_VALIDATION_ERROR', 'Geçersiz sorgu', 'Brain rejected request payload', details);
  }
}

export class BrainSchemaError extends BrainError {
  constructor(cause?: unknown) {
    super(502, 'BRAIN_SCHEMA_MISMATCH', 'Servis beklenmeyen bir yanıt verdi', 'Brain response did not match schema', cause);
  }
}
