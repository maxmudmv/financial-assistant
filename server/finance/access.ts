import crypto from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServerEnv } from '../config/env';
import { getSupabaseAdmin } from '../db/supabase';
import {
  extractSessionToken,
  loadSessionContextByToken,
  requireWorkspaceAccess,
  type AuthSessionContext,
  type AuthorizedWorkspace,
  type WorkspaceRole,
} from '../auth/session';
import { ForbiddenError, UnauthorizedError } from '../security/errors';
import { getClientIp } from '../security/headers';
import { enforceRateLimit } from '../security/rateLimit';

export const WRITE_ROLES: WorkspaceRole[] = ['owner', 'admin', 'member'];
export const ADMIN_ROLES: WorkspaceRole[] = ['owner', 'admin'];
export const ALL_ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'read_only'];

export interface AccountAccessRecord {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  visibility: 'workspace' | 'private' | 'selected_members';
  allowed_member_ids?: string[] | null;
}

export interface TransactionAccessRecord {
  id: string;
  workspace_id: string;
  account_id: string;
  created_by: string;
  is_private: boolean;
}

/**
 * Pure backend authorization check mirroring PostgreSQL RLS `can_access_account`.
 */
export function canUserAccessAccount(
  account: AccountAccessRecord,
  userId: string,
  authorizedWorkspaceId: string,
): boolean {
  if (account.workspace_id !== authorizedWorkspaceId) return false;
  if (account.visibility === 'workspace') return true;
  if (account.owner_user_id === userId) return true;
  if (
    account.visibility === 'selected_members' &&
    Array.isArray(account.allowed_member_ids) &&
    account.allowed_member_ids.includes(userId)
  ) {
    return true;
  }
  return false;
}

/**
 * Pure backend authorization check mirroring PostgreSQL RLS `transactions_select_isolated`.
 */
export function canUserViewTransaction(
  tx: TransactionAccessRecord,
  account: AccountAccessRecord,
  userId: string,
  authorizedWorkspaceId: string,
): boolean {
  if (tx.workspace_id !== authorizedWorkspaceId) return false;
  if (!canUserAccessAccount(account, userId, authorizedWorkspaceId)) return false;
  if (tx.is_private && tx.created_by !== userId) return false;
  return true;
}

/**
 * Pure backend authorization check for editing/voiding a transaction.
 */
export function canUserMutateTransaction(
  tx: TransactionAccessRecord,
  userId: string,
  role: WorkspaceRole,
): boolean {
  if (!WRITE_ROLES.includes(role)) return false;
  if (tx.created_by === userId) return true;
  if (!tx.is_private && ADMIN_ROLES.includes(role)) return true;
  return false;
}

export interface AuthenticatedApiContext {
  supabase: SupabaseClient;
  session: AuthSessionContext;
  workspace: AuthorizedWorkspace;
  clientIp: string;
  userAgent: string | null;
  idempotencyKey: string | null;
}

/**
 * Authenticates the request session, resolves and verifies workspace authorization,
 * enforces role permissions, and applies per-user serverless rate limiting.
 */
export async function authenticateFinanceRequest(
  req: VercelRequest,
  options: {
    allowedRoles?: WorkspaceRole[];
    rateLimitKey?: string;
    rateLimitMax?: number;
  } = {},
): Promise<AuthenticatedApiContext> {
  const env = getServerEnv();
  const supabase = getSupabaseAdmin();
  const clientIp = getClientIp(req);
  const userAgent =
    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

  const rawToken = extractSessionToken(req);
  if (!rawToken) {
    throw new UnauthorizedError('Authentication required');
  }

  const session = await loadSessionContextByToken({
    supabase,
    rawToken,
    sessionSecret: env.SESSION_SECRET,
  });

  const requestedWorkspaceId =
    (typeof req.headers['x-workspace-id'] === 'string' && req.headers['x-workspace-id'].trim()) ||
    (typeof req.query.workspaceId === 'string' && req.query.workspaceId.trim()) ||
    session.activeWorkspace.id;

  const workspace = requireWorkspaceAccess(
    session,
    requestedWorkspaceId,
    options.allowedRoles ?? ALL_ROLES,
  );

  await enforceRateLimit({
    supabase,
    bucketKey: `${options.rateLimitKey ?? 'finance'}:${session.user.id}`,
    limit: options.rateLimitMax ?? 120,
    windowSeconds: 60,
  });

  const rawIdempotency = req.headers['x-idempotency-key'];
  const idempotencyKey =
    typeof rawIdempotency === 'string' && rawIdempotency.trim().length > 0
      ? rawIdempotency.trim().slice(0, 128)
      : null;

  return {
    supabase,
    session,
    workspace,
    clientIp,
    userAgent,
    idempotencyKey,
  };
}

export function assertAccountAccessible(
  account: AccountAccessRecord | null | undefined,
  userId: string,
  workspaceId: string,
): asserts account is AccountAccessRecord {
  if (!account || !canUserAccessAccount(account, userId, workspaceId)) {
    throw new ForbiddenError('You do not have access to this account');
  }
}

/**
 * Verifies visibility/mutation permission on workspace-scoped entities that support
 * privacy (savings goals with `is_shared`, debts with `is_private`, budgets with `is_shared`).
 */
export function canUserAccessScopedRecord(params: {
  isPrivate: boolean;
  createdBy: string;
  userId: string;
}): boolean {
  if (!params.isPrivate) return true;
  return params.createdBy === params.userId;
}

/**
 * Fail-closed constant-time verification for Vercel Cron requests using `CRON_SECRET`.
 */
export function verifyCronAuthorization(
  authorizationHeader: string | undefined,
  configuredSecret: string | undefined,
): void {
  if (!configuredSecret || configuredSecret.trim().length < 16) {
    throw new UnauthorizedError('Cron endpoint is disabled until CRON_SECRET is configured');
  }
  const expected = `Bearer ${configuredSecret.trim()}`;
  const received = authorizationHeader ?? '';
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new UnauthorizedError('Invalid cron authorization');
  }
}
