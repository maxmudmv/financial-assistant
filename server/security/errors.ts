export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Invalid request', details?: Record<string, unknown>) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: Record<string, unknown>) {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Requested resource was not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(409, 'CONFLICT', message);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = 'Too many requests. Please try again later.') {
    super(429, 'RATE_LIMITED', message, { retryAfterSeconds });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}

export interface SafeErrorPayload {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function toSafeErrorResponse(err: unknown): {
  statusCode: number;
  body: SafeErrorPayload;
  retryAfterSeconds?: number;
} {
  if (err instanceof RateLimitError) {
    return {
      statusCode: err.statusCode,
      retryAfterSeconds: err.retryAfterSeconds,
      body: {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
    };
  }

  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
    };
  }

  // Never leak stack traces, SQL errors, or secrets to API consumers
  console.error('[FINORA API ERROR]', err instanceof Error ? err.message : 'Unknown error');
  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected server error occurred',
      },
    },
  };
}
