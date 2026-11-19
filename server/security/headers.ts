import type { VercelRequest, VercelResponse } from '@vercel/node';

export function applySecurityHeaders(req: VercelRequest, res: VercelResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const allowedOrigin = resolveAllowedOrigin(origin);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Idempotency-Key, X-Workspace-Id',
  );
}

export function resolveAllowedOrigin(origin?: string): string | null {
  if (!origin) return null;

  const configuredUrl = process.env.APP_URL;
  const allowlist = new Set<string>(['https://web.telegram.org']);

  if (configuredUrl) {
    try {
      allowlist.add(new URL(configuredUrl).origin);
    } catch {
      // ignore invalid URL
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    allowlist.add('http://localhost:5173');
    allowlist.add('http://localhost:3000');
    allowlist.add('http://127.0.0.1:5173');
  }

  return allowlist.has(origin) ? origin : null;
}

export function getClientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || '0.0.0.0';
}
