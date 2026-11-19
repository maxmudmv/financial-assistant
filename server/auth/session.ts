import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ForbiddenError, UnauthorizedError } from '../security/errors';
import type { SupportedLanguage } from './telegram';

export const SESSION_COOKIE_NAME = 'finora_session';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'read_only';
export type WorkspaceType = 'personal' | 'family';
export type ThemePreference = 'system' | 'dark' | 'light';

export interface AuthorizedWorkspace {
  id: string;
  name: string;
  type: WorkspaceType;
  role: WorkspaceRole;
  defaultCurrency: string;
}

export interface AuthenticatedUserProfile {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  languageCode: SupportedLanguage;
  photoUrl: string | null;
}

export interface AuthenticatedUserSettings {
  language: SupportedLanguage;
  theme: ThemePreference;
  reportingCurrency: string;
  activeWorkspaceId: string | null;
  timezone: string;
  hideBalances: boolean;
}

export interface AuthSessionContext {
  sessionId: string;
  expiresAt: string;
  user: AuthenticatedUserProfile;
  settings: AuthenticatedUserSettings;
  activeWorkspace: AuthorizedWorkspace;
  workspaces: AuthorizedWorkspace[];
}

export function generateOpaqueSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken: string, sessionSecret: string): string {
  return crypto.createHmac('sha256', sessionSecret).update(rawToken).digest('hex');
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};

  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const rawValue = part.slice(eqIndex + 1).trim();
    try {
      result[key] = decodeURIComponent(rawValue);
    } catch {
      result[key] = rawValue;
    }
  }
  return result;
}

export function extractSessionToken(req: VercelRequest): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken && cookieToken.length >= 32) {
    return cookieToken;
  }

  // Fallback for Telegram WebView contexts where third-party cookies may be restricted.
  // Frontend keeps this token in memory only — never localStorage.
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer.length >= 32) {
      return bearer;
    }
  }

  return null;
}

export function buildSessionCookie(options: {
  token: string;
  maxAgeSeconds: number;
  isProduction: boolean;
}): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(options.token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];

  if (options.isProduction) {
    // SameSite=None + Secure is required for Telegram Mini App embedded WebViews on HTTPS
    parts.push('Secure', 'SameSite=None');
  } else {
    parts.push('SameSite=Lax');
  }

  return parts.join('; ');
}

export function buildClearSessionCookie(isProduction: boolean): string {
  return buildSessionCookie({
    token: '',
    maxAgeSeconds: 0,
    isProduction,
  });
}

export function setSessionCookieHeader(res: VercelResponse, cookieString: string): void {
  res.setHeader('Set-Cookie', cookieString);
}

export async function createDbSession(options: {
  supabase: SupabaseClient;
  userId: string;
  activeWorkspaceId: string;
  telegramAuthDate: Date;
  sessionSecret: string;
  ttlSeconds: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ rawToken: string; sessionId: string; expiresAt: string }> {
  const rawToken = generateOpaqueSessionToken();
  const tokenHash = hashSessionToken(rawToken, options.sessionSecret);
  const expiresAt = new Date(Date.now() + options.ttlSeconds * 1000).toISOString();

  const safeIp =
    options.ipAddress && /^[0-9a-fA-F:.]+$/.test(options.ipAddress) ? options.ipAddress : null;

  const { data, error } = await options.supabase
    .from('sessions')
    .insert({
      user_id: options.userId,
      token_hash: tokenHash,
      active_workspace_id: options.activeWorkspaceId,
      telegram_auth_date: options.telegramAuthDate.toISOString(),
      ip_address: safeIp,
      user_agent: options.userAgent ? options.userAgent.slice(0, 500) : null,
      expires_at: expiresAt,
    })
    .select('id, expires_at')
    .single();

  if (error || !data) {
    throw new Error(`Failed to persist session: ${error?.message ?? 'unknown error'}`);
  }

  return {
    rawToken,
    sessionId: data.id as string,
    expiresAt: data.expires_at as string,
  };
}

export async function loadSessionContextByToken(options: {
  supabase: SupabaseClient;
  rawToken: string;
  sessionSecret: string;
}): Promise<AuthSessionContext> {
  const tokenHash = hashSessionToken(options.rawToken, options.sessionSecret);

  const { data: sessionRow, error: sessionErr } = await options.supabase
    .from('sessions')
    .select('id, user_id, active_workspace_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (sessionErr || !sessionRow) {
    throw new UnauthorizedError('Invalid or expired session');
  }

  if (sessionRow.revoked_at) {
    throw new UnauthorizedError('Session has been revoked');
  }

  if (new Date(sessionRow.expires_at as string).getTime() <= Date.now()) {
    throw new UnauthorizedError('Session has expired');
  }

  const userId = sessionRow.user_id as string;

  const [userRes, settingsRes, membershipsRes] = await Promise.all([
    options.supabase
      .from('users')
      .select('id, telegram_id, username, first_name, last_name, language_code, photo_url, is_active, deleted_at')
      .eq('id', userId)
      .maybeSingle(),
    options.supabase
      .from('user_settings')
      .select('language, theme, reporting_currency, active_workspace_id, timezone, hide_balances')
      .eq('user_id', userId)
      .maybeSingle(),
    options.supabase
      .from('workspace_members')
      .select('role, workspace:workspaces!inner(id, name, type, default_currency, is_archived)')
      .eq('user_id', userId),
  ]);

  if (userRes.error || !userRes.data || !userRes.data.is_active || userRes.data.deleted_at) {
    throw new UnauthorizedError('User account is inactive or unavailable');
  }

  const rawMemberships = (membershipsRes.data ?? []) as Array<{
    role: WorkspaceRole;
    workspace:
      | {
          id: string;
          name: string;
          type: WorkspaceType;
          default_currency: string;
          is_archived: boolean;
        }
      | Array<{
          id: string;
          name: string;
          type: WorkspaceType;
          default_currency: string;
          is_archived: boolean;
        }>;
  }>;

  const workspaces: AuthorizedWorkspace[] = rawMemberships
    .map((row) => {
      const ws = Array.isArray(row.workspace) ? row.workspace[0] : row.workspace;
      if (!ws || ws.is_archived) return null;
      return {
        id: ws.id,
        name: ws.name,
        type: ws.type,
        role: row.role,
        defaultCurrency: ws.default_currency,
      };
    })
    .filter((item): item is AuthorizedWorkspace => item !== null);

  if (workspaces.length === 0) {
    throw new ForbiddenError('No active workspace is assigned to this account');
  }

  const preferredWorkspaceId =
    (sessionRow.active_workspace_id as string | null) ??
    (settingsRes.data?.active_workspace_id as string | null);

  const activeWorkspace =
    workspaces.find((ws) => ws.id === preferredWorkspaceId) ??
    workspaces.find((ws) => ws.type === 'personal') ??
    workspaces[0];

  // Update last_seen_at asynchronously without blocking auth response
  void options.supabase
    .from('sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', sessionRow.id);

  return {
    sessionId: sessionRow.id as string,
    expiresAt: sessionRow.expires_at as string,
    user: {
      id: userRes.data.id as string,
      telegramId: Number(userRes.data.telegram_id),
      username: (userRes.data.username as string | null) ?? null,
      firstName: userRes.data.first_name as string,
      lastName: (userRes.data.last_name as string | null) ?? null,
      languageCode: (userRes.data.language_code as SupportedLanguage) ?? 'uz',
      photoUrl: (userRes.data.photo_url as string | null) ?? null,
    },
    settings: {
      language: (settingsRes.data?.language as SupportedLanguage) ?? 'uz',
      theme: (settingsRes.data?.theme as ThemePreference) ?? 'system',
      reportingCurrency: (settingsRes.data?.reporting_currency as string) ?? 'UZS',
      activeWorkspaceId: activeWorkspace.id,
      timezone: (settingsRes.data?.timezone as string) ?? 'Asia/Tashkent',
      hideBalances: Boolean(settingsRes.data?.hide_balances),
    },
    activeWorkspace,
    workspaces,
  };
}

/**
 * Pure backend authorization guard verifying that the authenticated user is a
 * member of `targetWorkspaceId` (prevents horizontal cross-workspace IDOR).
 */
export function requireWorkspaceAccess(
  session: AuthSessionContext,
  targetWorkspaceId: string,
  allowedRoles?: WorkspaceRole[],
): AuthorizedWorkspace {
  const workspace = session.workspaces.find((ws) => ws.id === targetWorkspaceId);
  if (!workspace) {
    throw new ForbiddenError('Access to the requested workspace is denied');
  }

  if (allowedRoles && !allowedRoles.includes(workspace.role)) {
    throw new ForbiddenError('Insufficient workspace role for this operation');
  }

  return workspace;
}

export async function revokeDbSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  await supabase
    .from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', sessionId);
}
