import { describe, expect, it } from 'vitest';
import type { VercelRequest } from '@vercel/node';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  extractSessionToken,
  generateOpaqueSessionToken,
  hashSessionToken,
  parseCookies,
  requireWorkspaceAccess,
  SESSION_COOKIE_NAME,
  type AuthSessionContext,
} from '../../server/auth/session';
import { ForbiddenError } from '../../server/security/errors';

const TEST_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Session cryptography, cookies, and workspace authorization', () => {
  it('generates high-entropy opaque tokens and deterministic secret-keyed hashes', () => {
    const tokenA = generateOpaqueSessionToken();
    const tokenB = generateOpaqueSessionToken();

    expect(tokenA).not.toBe(tokenB);
    expect(tokenA.length).toBeGreaterThanOrEqual(40);

    const hash1 = hashSessionToken(tokenA, TEST_SECRET);
    const hash2 = hashSessionToken(tokenA, TEST_SECRET);
    const hashDifferentSecret = hashSessionToken(tokenA, `${TEST_SECRET}x`);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    expect(hash1).not.toBe(hashDifferentSecret);
    expect(hash1).not.toContain(tokenA);
  });

  it('builds secure HttpOnly cookies for production Telegram WebViews and dev', () => {
    const prodCookie = buildSessionCookie({
      token: 'opaque_token_example_12345678901234567890',
      maxAgeSeconds: 3600,
      isProduction: true,
    });
    expect(prodCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(prodCookie).toContain('HttpOnly');
    expect(prodCookie).toContain('Secure');
    expect(prodCookie).toContain('SameSite=None');
    expect(prodCookie).toContain('Max-Age=3600');

    const devCookie = buildSessionCookie({
      token: 'opaque_token_example_12345678901234567890',
      maxAgeSeconds: 3600,
      isProduction: false,
    });
    expect(devCookie).toContain('HttpOnly');
    expect(devCookie).toContain('SameSite=Lax');
    expect(devCookie).not.toContain('Secure');

    const cleared = buildClearSessionCookie(true);
    expect(cleared).toContain('Max-Age=0');
  });

  it('extracts session tokens from HttpOnly cookie first, then Bearer header fallback', () => {
    const token = generateOpaqueSessionToken();

    const fromCookie = extractSessionToken({
      headers: { cookie: `other=1; ${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
    } as unknown as VercelRequest);
    expect(fromCookie).toBe(token);

    const fromBearer = extractSessionToken({
      headers: { authorization: `Bearer ${token}` },
    } as unknown as VercelRequest);
    expect(fromBearer).toBe(token);

    const parsed = parseCookies(`a=1; b=hello%20world`);
    expect(parsed).toEqual({ a: '1', b: 'hello world' });
  });

  it('enforces strict workspace isolation and RBAC role boundaries', () => {
    const session: AuthSessionContext = {
      sessionId: 'sess-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: {
        id: 'user-a',
        telegramId: 10001,
        username: 'alice',
        firstName: 'Alice',
        lastName: null,
        languageCode: 'uz',
        photoUrl: null,
      },
      settings: {
        language: 'uz',
        theme: 'dark',
        reportingCurrency: 'UZS',
        activeWorkspaceId: 'ws-personal-a',
        timezone: 'Asia/Tashkent',
        hideBalances: false,
      },
      activeWorkspace: {
        id: 'ws-personal-a',
        name: 'Shaxsiy',
        type: 'personal',
        role: 'owner',
        defaultCurrency: 'UZS',
      },
      workspaces: [
        {
          id: 'ws-personal-a',
          name: 'Shaxsiy',
          type: 'personal',
          role: 'owner',
          defaultCurrency: 'UZS',
        },
        {
          id: 'ws-family-shared',
          name: 'Oila',
          type: 'family',
          role: 'read_only',
          defaultCurrency: 'USD',
        },
      ],
    };

    // Allowed: own workspace
    expect(requireWorkspaceAccess(session, 'ws-personal-a').role).toBe('owner');

    // Blocked: horizontal cross-workspace access to another user's workspace
    expect(() => requireWorkspaceAccess(session, 'ws-victim-b')).toThrowError(ForbiddenError);

    // Blocked: read_only member attempting write-privileged operation
    expect(() =>
      requireWorkspaceAccess(session, 'ws-family-shared', ['owner', 'admin', 'member']),
    ).toThrowError(ForbiddenError);

    // Allowed: read_only member reading family workspace
    expect(
      requireWorkspaceAccess(session, 'ws-family-shared', ['owner', 'admin', 'member', 'read_only'])
        .id,
    ).toBe('ws-family-shared');
  });
});
