import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applySecurityHeaders } from '../security/headers';
import { BadRequestError, toSafeErrorResponse } from '../security/errors';

export function sendJson<T>(res: VercelResponse, statusCode: number, data: T): void {
  res.status(statusCode).json(data);
}

export function sendError(res: VercelResponse, err: unknown): void {
  const safe = toSafeErrorResponse(err);
  if (safe.retryAfterSeconds) {
    res.setHeader('Retry-After', String(safe.retryAfterSeconds));
  }
  res.status(safe.statusCode).json(safe.body);
}

export function parseJsonBody(req: VercelRequest): unknown {
  if (req.body === undefined || req.body === null) {
    return {};
  }
  if (typeof req.body === 'string') {
    if (req.body.trim().length === 0) return {};
    try {
      return JSON.parse(req.body);
    } catch {
      throw new BadRequestError('Malformed JSON request body');
    }
  }
  if (typeof req.body === 'object') {
    return req.body;
  }
  throw new BadRequestError('Unsupported request body format');
}

export type ServerlessHandler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

export function withApiHandler(handler: ServerlessHandler): ServerlessHandler {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    applySecurityHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    try {
      await handler(req, res);
    } catch (err) {
      sendError(res, err);
    }
  };
}
