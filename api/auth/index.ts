import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getServerEnv } from '../../server/config/env.js';
import { getSupabaseAdmin } from '../../server/db/supabase.js';
import { verifyTelegramInitData } from '../../server/auth/telegram.js';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createDbSession,
  extractSessionToken,
  loadSessionContextByToken,
  requireWorkspaceAccess,
  revokeDbSession,
  setSessionCookieHeader,
} from '../../server/auth/session.js';
import { parseJsonBody, sendJson, withApiHandler } from '../../server/http/response.js';
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../server/security/errors.js';
import { getClientIp } from '../../server/security/headers.js';
import { enforceRateLimit } from '../../server/security/rateLimit.js';
import { recordAuditLog } from '../../server/security/audit.js';

const TelegramLoginBodySchema = z.object({
  initData: z.string().min(10, 'Telegram initData is required').max(8192),
});

const SwitchWorkspaceBodySchema = z.object({
  workspaceId: z.string().uuid('workspaceId must be a valid UUID'),
});

function resolveAction(req: VercelRequest): string {
  const queryAction = req.query.action;
  if (typeof queryAction === 'string' && queryAction.trim().length > 0) {
    return queryAction.trim().toLowerCase();
  }
  const pathname = (req.url ?? '').split('?')[0];
  const segments = pathname.split('/').filter(Boolean);
  // /api/auth/<action>
  return (segments[2] ?? '').toLowerCase();
}

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  const action = resolveAction(req);
  const env = getServerEnv();
  const supabase = getSupabaseAdmin();
  const clientIp = getClientIp(req);
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
  const isProduction = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';

  // --------------------------------------------------------------------------
  // POST /api/auth/telegram — Verify Telegram initData & establish session
  // --------------------------------------------------------------------------
  if (action === 'telegram') {
    if (req.method !== 'POST') {
      throw new BadRequestError('Use POST for /api/auth/telegram');
    }

    await enforceRateLimit({
      supabase,
      bucketKey: `auth:telegram:${clientIp}`,
      limit: 15,
      windowSeconds: 60,
    });

    const parsedBody = TelegramLoginBodySchema.safeParse(parseJsonBody(req));
    if (!parsedBody.success) {
      throw new ValidationError('Invalid Telegram authentication request', {
        issues: parsedBody.error.flatten().fieldErrors,
      });
    }

    let verified;
    try {
      verified = verifyTelegramInitData(parsedBody.data.initData, {
        botToken: env.TELEGRAM_BOT_TOKEN,
        maxAgeSeconds: env.TELEGRAM_AUTH_MAX_AGE_SECONDS,
      });
    } catch (authError) {
      await recordAuditLog(supabase, {
        action: 'auth.telegram_verification_failed',
        entityType: 'session',
        ipAddress: clientIp,
        userAgent,
        metadata: {
          reason: authError instanceof Error ? authError.message : 'verification_failed',
        },
      });
      throw authError;
    }

    // Atomically find/create user, personal workspace, settings, and default categories
    const { data: bootstrapRows, error: bootstrapError } = await supabase.rpc(
      'bootstrap_telegram_user',
      {
        p_telegram_id: verified.user.telegramId,
        p_username: verified.user.username,
        p_first_name: verified.user.firstName,
        p_last_name: verified.user.lastName,
        p_language_code: verified.user.languageCode,
        p_photo_url: verified.user.photoUrl,
      },
    );

    if (bootstrapError || !Array.isArray(bootstrapRows) || bootstrapRows.length === 0) {
      throw new Error(`User bootstrap failed: ${bootstrapError?.message ?? 'empty result'}`);
    }

    const bootstrap = bootstrapRows[0] as {
      user_id: string;
      is_new_user: boolean;
      active_workspace_id: string;
    };

    const createdSession = await createDbSession({
      supabase,
      userId: bootstrap.user_id,
      activeWorkspaceId: bootstrap.active_workspace_id,
      telegramAuthDate: verified.authDate,
      sessionSecret: env.SESSION_SECRET,
      ttlSeconds: env.SESSION_TTL_SECONDS,
      ipAddress: clientIp,
      userAgent,
    });

    const sessionContext = await loadSessionContextByToken({
      supabase,
      rawToken: createdSession.rawToken,
      sessionSecret: env.SESSION_SECRET,
    });

    setSessionCookieHeader(
      res,
      buildSessionCookie({
        token: createdSession.rawToken,
        maxAgeSeconds: env.SESSION_TTL_SECONDS,
        isProduction,
      }),
    );

    await recordAuditLog(supabase, {
      workspaceId: sessionContext.activeWorkspace.id,
      actorUserId: sessionContext.user.id,
      action: bootstrap.is_new_user ? 'auth.telegram_register' : 'auth.telegram_login',
      entityType: 'session',
      entityId: sessionContext.sessionId,
      ipAddress: clientIp,
      userAgent,
      metadata: {
        telegramId: sessionContext.user.telegramId,
        isNewUser: bootstrap.is_new_user,
      },
    });

    sendJson(res, 200, {
      authenticated: true,
      // Returned exclusively for in-memory Bearer fallback in strict Telegram WebViews
      sessionToken: createdSession.rawToken,
      session: {
        id: sessionContext.sessionId,
        expiresAt: sessionContext.expiresAt,
      },
      user: sessionContext.user,
      settings: sessionContext.settings,
      activeWorkspace: sessionContext.activeWorkspace,
      workspaces: sessionContext.workspaces,
    });
    return;
  }

  // --------------------------------------------------------------------------
  // GET /api/auth/session — Validate current session & load authorized context
  // --------------------------------------------------------------------------
  if (action === 'session') {
    if (req.method !== 'GET') {
      throw new BadRequestError('Use GET for /api/auth/session');
    }

    await enforceRateLimit({
      supabase,
      bucketKey: `auth:session:${clientIp}`,
      limit: 60,
      windowSeconds: 60,
    });

    const rawToken = extractSessionToken(req);
    if (!rawToken) {
      throw new UnauthorizedError('No active session');
    }

    const sessionContext = await loadSessionContextByToken({
      supabase,
      rawToken,
      sessionSecret: env.SESSION_SECRET,
    });

    sendJson(res, 200, {
      authenticated: true,
      session: {
        id: sessionContext.sessionId,
        expiresAt: sessionContext.expiresAt,
      },
      user: sessionContext.user,
      settings: sessionContext.settings,
      activeWorkspace: sessionContext.activeWorkspace,
      workspaces: sessionContext.workspaces,
    });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/auth/switch-workspace — Switch active workspace (with authz check)
  // --------------------------------------------------------------------------
  if (action === 'switch-workspace') {
    if (req.method !== 'POST') {
      throw new BadRequestError('Use POST for /api/auth/switch-workspace');
    }

    const rawToken = extractSessionToken(req);
    if (!rawToken) {
      throw new UnauthorizedError('Authentication required');
    }

    const sessionContext = await loadSessionContextByToken({
      supabase,
      rawToken,
      sessionSecret: env.SESSION_SECRET,
    });

    const parsedBody = SwitchWorkspaceBodySchema.safeParse(parseJsonBody(req));
    if (!parsedBody.success) {
      throw new ValidationError('Invalid workspace selection', {
        issues: parsedBody.error.flatten().fieldErrors,
      });
    }

    // Strict backend authorization check: user MUST be an active member
    const targetWorkspace = requireWorkspaceAccess(sessionContext, parsedBody.data.workspaceId);

    await Promise.all([
      supabase
        .from('sessions')
        .update({ active_workspace_id: targetWorkspace.id })
        .eq('id', sessionContext.sessionId),
      supabase
        .from('user_settings')
        .update({ active_workspace_id: targetWorkspace.id })
        .eq('user_id', sessionContext.user.id),
    ]);

    await recordAuditLog(supabase, {
      workspaceId: targetWorkspace.id,
      actorUserId: sessionContext.user.id,
      action: 'auth.workspace_switched',
      entityType: 'workspace',
      entityId: targetWorkspace.id,
      ipAddress: clientIp,
      userAgent,
      metadata: {
        previousWorkspaceId: sessionContext.activeWorkspace.id,
        newWorkspaceId: targetWorkspace.id,
      },
    });

    sendJson(res, 200, {
      activeWorkspace: targetWorkspace,
      workspaces: sessionContext.workspaces,
    });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/auth/logout — Revoke DB session & clear HttpOnly cookie
  // --------------------------------------------------------------------------
  if (action === 'logout') {
    if (req.method !== 'POST') {
      throw new BadRequestError('Use POST for /api/auth/logout');
    }

    const rawToken = extractSessionToken(req);
    if (rawToken) {
      try {
        const sessionContext = await loadSessionContextByToken({
          supabase,
          rawToken,
          sessionSecret: env.SESSION_SECRET,
        });
        await revokeDbSession(supabase, sessionContext.sessionId);
        await recordAuditLog(supabase, {
          workspaceId: sessionContext.activeWorkspace.id,
          actorUserId: sessionContext.user.id,
          action: 'auth.logout',
          entityType: 'session',
          entityId: sessionContext.sessionId,
          ipAddress: clientIp,
          userAgent,
        });
      } catch {
        // Still clear cookie even if session was already expired/revoked
      }
    }

    setSessionCookieHeader(res, buildClearSessionCookie(isProduction));
    sendJson(res, 200, { authenticated: false });
    return;
  }

  throw new NotFoundError('Unknown authentication endpoint');
});
