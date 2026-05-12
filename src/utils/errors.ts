export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class AuthError extends AppError {
  constructor(message = 'Yetkisiz', code = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Yasak', code = 'FORBIDDEN') {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Bulunamadı', code = 'NOT_FOUND') {
    super(404, code, message);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Geçersiz istek', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class InsufficientCreditsError extends AppError {
  constructor() {
    super(402, 'INSUFFICIENT_CREDITS', 'Yetersiz kredi');
  }
}
