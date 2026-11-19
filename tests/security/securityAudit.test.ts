import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canUserAccessScopedRecord,
  verifyCronAuthorization,
} from '../../server/finance/access';
import { computeRequestPayloadHash } from '../../server/finance/idempotency';
import { toSafeErrorResponse, UnauthorizedError } from '../../server/security/errors';
import { resolveAllowedOrigin } from '../../server/security/headers';

describe('Production security hardening & zero-cost free-tier audit', () => {
  it('enforces fail-closed constant-time CRON_SECRET verification', () => {
    const validSecret = 'super-secret-cron-token-min-16-chars';

    // Missing or weak CRON_SECRET must ALWAYS fail closed
    expect(() => verifyCronAuthorization(`Bearer ${validSecret}`, undefined)).toThrowError(
      UnauthorizedError,
    );
    expect(() => verifyCronAuthorization('Bearer short', 'short')).toThrowError(UnauthorizedError);

    // Wrong or missing header must fail
    expect(() => verifyCronAuthorization(undefined, validSecret)).toThrowError(UnauthorizedError);
    expect(() => verifyCronAuthorization('Bearer wrong-token-value', validSecret)).toThrowError(
      UnauthorizedError,
    );

    // Exact Bearer secret succeeds
    expect(() => verifyCronAuthorization(`Bearer ${validSecret}`, validSecret)).not.toThrow();
  });

  it('isolates private goals, private debts, and private budgets from other workspace members', () => {
    expect(
      canUserAccessScopedRecord({ isPrivate: true, createdBy: 'user-a', userId: 'user-a' }),
    ).toBe(true);
    expect(
      canUserAccessScopedRecord({ isPrivate: true, createdBy: 'user-a', userId: 'user-b' }),
    ).toBe(false);
    expect(
      canUserAccessScopedRecord({ isPrivate: false, createdBy: 'user-a', userId: 'user-b' }),
    ).toBe(true);
  });

  it('never leaks internal SQL errors, secrets, or stack traces in API error responses', () => {
    const rawDbError = new Error(
      'ERROR: duplicate key value violates unique constraint "users_telegram_id_key" on SUPABASE_SERVICE_ROLE_KEY',
    );
    const safe = toSafeErrorResponse(rawDbError);

    expect(safe.statusCode).toBe(500);
    expect(safe.body.error.code).toBe('INTERNAL_ERROR');
    expect(safe.body.error.message).not.toContain('users_telegram_id_key');
    expect(safe.body.error.message).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('produces canonical SHA-256 idempotency payload hashes regardless of key order', () => {
    const h1 = computeRequestPayloadHash({ amount: '100.0000', accountId: 'a1', tags: ['food'] });
    const h2 = computeRequestPayloadHash({ tags: ['food'], accountId: 'a1', amount: '100.0000' });
    const h3 = computeRequestPayloadHash({ amount: '100.0001', accountId: 'a1', tags: ['food'] });

    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it('enforces strict CORS origin allowlist', () => {
    expect(resolveAllowedOrigin('https://web.telegram.org')).toBe('https://web.telegram.org');
    expect(resolveAllowedOrigin('https://evil-phishing.example.com')).toBeNull();
  });

  it('verifies Vercel Hobby free-tier limits (<= 12 serverless functions, daily cron, zero paid deps)', () => {
    const apiDir = path.resolve(process.cwd(), 'api');
    const collectTsFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries.flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return collectTsFiles(full);
        return entry.name.endsWith('.ts') ? [full] : [];
      });
    };

    const apiFunctions = collectTsFiles(apiDir);
    expect(apiFunctions.length).toBeLessThanOrEqual(12);

    const vercelConfig = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8'),
    ) as {
      functions: Record<string, { maxDuration: number }>;
      crons: Array<{ path: string; schedule: string }>;
    };

    expect(vercelConfig.functions['api/**/*.ts'].maxDuration).toBeLessThanOrEqual(10);
    expect(vercelConfig.crons.length).toBeLessThanOrEqual(2);
    // Daily cron format (not per-minute `*/1 * * * *`)
    expect(vercelConfig.crons[0].schedule).toBe('0 6 * * *');

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
    };
    const depNames = Object.keys(pkg.dependencies);
    expect(depNames).not.toContain('redis');
    expect(depNames).not.toContain('ioredis');
    expect(depNames).not.toContain('bullmq');
    expect(depNames).not.toContain('@nestjs/core');
  });
});
