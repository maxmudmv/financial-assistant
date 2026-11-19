import { beforeEach, describe, expect, it } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import healthHandler from '../../api/health';
import { resetCachedEnvForTests } from '../../server/config/env';

function createMockRes() {
  const headers: Record<string, string | string[]> = {};
  let statusCode = 200;
  let jsonBody: unknown = null;
  let ended = false;

  const res = {
    setHeader(key: string, value: string | string[]) {
      headers[key.toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      jsonBody = payload;
      ended = true;
      return this;
    },
    end() {
      ended = true;
      return this;
    },
  } as unknown as VercelResponse;

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => jsonBody,
    getHeaders: () => headers,
    isEnded: () => ended,
  };
}

describe('Serverless API handler security contract', () => {
  beforeEach(() => {
    resetCachedEnvForTests();
  });

  it('returns readiness status and strict security headers without leaking secrets', async () => {
    const req = {
      method: 'GET',
      url: '/api/health',
      headers: {},
      query: {},
    } as unknown as VercelRequest;

    const mock = createMockRes();
    await healthHandler(req, mock.res);

    expect(mock.getStatus()).toBe(200);
    expect(mock.getHeaders()['x-content-type-options']).toBe('nosniff');
    expect(mock.getHeaders()['cache-control']).toContain('no-store');

    const body = mock.getBody() as Record<string, unknown>;
    expect(body.service).toBe('finora-api');
    expect(JSON.stringify(body)).not.toContain('SERVICE_ROLE');
    expect(JSON.stringify(body)).not.toContain('BOT_TOKEN');
  });

  it('rejects unsupported HTTP methods on /api/health with safe structured error', async () => {
    const req = {
      method: 'DELETE',
      url: '/api/health',
      headers: {},
      query: {},
    } as unknown as VercelRequest;

    const mock = createMockRes();
    await healthHandler(req, mock.res);

    expect(mock.getStatus()).toBe(400);
    const body = mock.getBody() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});
