import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getConfigReadiness } from '../server/config/env.js';
import { sendJson, withApiHandler } from '../server/http/response.js';
import { BadRequestError } from '../server/security/errors.js';

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') {
    throw new BadRequestError('Method not allowed');
  }

  const readiness = getConfigReadiness();
  const ready =
    readiness.supabaseConfigured &&
    readiness.telegramConfigured &&
    readiness.sessionConfigured;

  sendJson(res, 200, {
    status: ready ? 'ok' : 'degraded',
    service: 'finora-api',
    phase: 'foundation-auth-db',
    timestamp: new Date().toISOString(),
    readiness,
  });
});
