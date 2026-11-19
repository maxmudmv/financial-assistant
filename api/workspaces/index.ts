import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { parseJsonBody, sendJson, withApiHandler } from '../../server/http/response';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../server/security/errors';
import { recordAuditLog } from '../../server/security/audit';
import { getClientIp } from '../../server/security/headers';
import { enforceRateLimit } from '../../server/security/rateLimit';
import { getServerEnv } from '../../server/config/env';
import { getSupabaseAdmin } from '../../server/db/supabase';
import { extractSessionToken, loadSessionContextByToken } from '../../server/auth/session';
import {
  ADMIN_ROLES,
  ALL_ROLES,
  authenticateFinanceRequest,
} from '../../server/finance/access';
import { normalizeCurrencyCode } from '../../server/finance/money';

const CreateFamilyWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  defaultCurrency: z.string().trim().length(3).default('UZS'),
});

const CreateInviteSchema = z.object({
  role: z.enum(['admin', 'member', 'read_only']).default('member'),
  inviteeUsername: z.string().trim().max(64).optional().nullable(),
  maxUses: z.number().int().min(1).max(10).default(1),
});

const AcceptInviteSchema = z.object({
  token: z.string().trim().min(16).max(256),
});

const UpdateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'read_only']),
});

const UpdateSettingsSchema = z.object({
  language: z.enum(['uz', 'ru', 'en']).optional(),
  theme: z.enum(['system', 'dark', 'light']).optional(),
  reportingCurrency: z.string().trim().length(3).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  hideBalances: z.boolean().optional(),
  notificationPreferences: z
    .object({
      telegramEnabled: z.boolean().optional(),
      budgetWarnings: z.boolean().optional(),
      upcomingPayments: z.boolean().optional(),
      debtReminders: z.boolean().optional(),
      goalMilestones: z.boolean().optional(),
      weeklySummary: z.boolean().optional(),
      monthlySummary: z.boolean().optional(),
    })
    .optional(),
});

function resolveRoute(req: VercelRequest): {
  section: 'root' | 'members' | 'invitations' | 'accept' | 'settings' | 'account';
  id: string | null;
} {
  const qSub = typeof req.query.sub === 'string' ? req.query.sub.trim() : '';
  const qAction = typeof req.query.action === 'string' ? req.query.action.trim() : '';

  if (qSub === 'invitations' && qAction === 'accept') return { section: 'accept', id: null };
  if (qSub === 'invitations') return { section: 'invitations', id: qAction || null };
  if (qSub === 'members') return { section: 'members', id: qAction || null };
  if (qSub === 'settings') return { section: 'settings', id: null };
  if (qSub === 'account') return { section: 'account', id: null };

  const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean); // ['api', 'workspaces', ...]
  if (parts[2] === 'invitations' && parts[3] === 'accept') return { section: 'accept', id: null };
  if (parts[2] === 'invitations') return { section: 'invitations', id: parts[3] ?? null };
  if (parts[2] === 'members') return { section: 'members', id: parts[3] ?? null };
  if (parts[2] === 'settings') return { section: 'settings', id: null };
  if (parts[2] === 'account') return { section: 'account', id: null };
  return { section: 'root', id: parts[2] ?? null };
}

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  const route = resolveRoute(req);

  // --------------------------------------------------------------------------
  // POST /api/workspaces — Create a new Family Workspace
  // --------------------------------------------------------------------------
  if (route.section === 'root' && req.method === 'POST') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'workspaces:create',
    });

    const parsed = CreateFamilyWorkspaceSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid workspace payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const currency = normalizeCurrencyCode(parsed.data.defaultCurrency);

    const { data: ws, error } = await ctx.supabase
      .from('workspaces')
      .insert({
        name: parsed.data.name,
        type: 'family',
        owner_user_id: ctx.session.user.id,
        default_currency: currency,
      })
      .select('id, name, type, default_currency')
      .single();

    if (error || !ws) {
      throw new Error(`Failed to create family workspace: ${error?.message ?? 'unknown'}`);
    }

    await ctx.supabase.from('workspace_members').insert({
      workspace_id: ws.id,
      user_id: ctx.session.user.id,
      role: 'owner',
    });

    // Starter family cash account + default categories
    await ctx.supabase.from('accounts').insert({
      workspace_id: ws.id,
      owner_user_id: ctx.session.user.id,
      name: `${parsed.data.name} Cash`,
      type: 'cash',
      currency,
      opening_balance: 0,
      current_balance: 0,
      visibility: 'workspace',
    });

    await recordAuditLog(ctx.supabase, {
      workspaceId: ws.id as string,
      actorUserId: ctx.session.user.id,
      action: 'workspace.family_created',
      entityType: 'workspace',
      entityId: ws.id as string,
      ipAddress: ctx.clientIp,
      userAgent: ctx.userAgent,
    });

    sendJson(res, 201, {
      workspace: {
        id: ws.id,
        name: ws.name,
        type: ws.type,
        role: 'owner',
        defaultCurrency: ws.default_currency,
      },
    });
    return;
  }

  // --------------------------------------------------------------------------
  // GET /api/workspaces/members — List active workspace members & invitations
  // --------------------------------------------------------------------------
  if (route.section === 'members' && !route.id && req.method === 'GET') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'workspaces:members',
    });

    const [membersRes, invitesRes] = await Promise.all([
      ctx.supabase
        .from('workspace_members')
        .select('id, role, joined_at, user:users!inner(id, telegram_id, username, first_name, last_name, photo_url)')
        .eq('workspace_id', ctx.workspace.id)
        .order('joined_at', { ascending: true }),
      ADMIN_ROLES.includes(ctx.workspace.role)
        ? ctx.supabase
            .from('workspace_invitations')
            .select('id, role, invitee_telegram_username, status, max_uses, use_count, expires_at, created_at')
            .eq('workspace_id', ctx.workspace.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

    const members = ((membersRes.data ?? []) as Array<Record<string, unknown>>).map((m) => {
      const u = (Array.isArray(m.user) ? m.user[0] : m.user) as Record<string, unknown>;
      return {
        memberId: m.id,
        userId: u.id,
        role: m.role,
        joinedAt: m.joined_at,
        username: u.username,
        firstName: u.first_name,
        lastName: u.last_name,
        photoUrl: u.photo_url,
      };
    });

    sendJson(res, 200, {
      workspace: ctx.workspace,
      members,
      invitations: invitesRes.data ?? [],
    });
    return;
  }

  // --------------------------------------------------------------------------
  // PATCH/DELETE /api/workspaces/members/:id — Update role or remove member
  // --------------------------------------------------------------------------
  if (route.section === 'members' && route.id) {
    if (!z.string().uuid().safeParse(route.id).success) {
      throw new BadRequestError('Invalid member ID');
    }

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ADMIN_ROLES,
      rateLimitKey: 'workspaces:member_manage',
    });

    const { data: target } = await ctx.supabase
      .from('workspace_members')
      .select('id, user_id, role')
      .eq('id', route.id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!target) throw new NotFoundError('Workspace member not found');
    if (target.role === 'owner') {
      throw new ForbiddenError('Workspace owner role cannot be modified or removed');
    }

    if (req.method === 'PATCH') {
      const parsed = UpdateMemberRoleSchema.safeParse(parseJsonBody(req));
      if (!parsed.success) throw new ValidationError('Invalid role');

      await ctx.supabase
        .from('workspace_members')
        .update({ role: parsed.data.role })
        .eq('id', route.id);

      sendJson(res, 200, { memberId: route.id, role: parsed.data.role });
      return;
    }

    if (req.method === 'DELETE') {
      await ctx.supabase.from('workspace_members').delete().eq('id', route.id);
      sendJson(res, 200, { removed: true, memberId: route.id });
      return;
    }

    throw new BadRequestError('Method not allowed');
  }

  // --------------------------------------------------------------------------
  // POST /api/workspaces/invitations — Generate secure tokenized family invite
  // --------------------------------------------------------------------------
  if (route.section === 'invitations' && !route.id && req.method === 'POST') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ADMIN_ROLES,
      rateLimitKey: 'workspaces:invite',
    });

    if (ctx.workspace.type !== 'family') {
      throw new ValidationError('Invitations are only supported for family workspaces');
    }

    const parsed = CreateInviteSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid invitation payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const rawToken = crypto.randomBytes(24).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();

    const { data, error } = await ctx.supabase
      .from('workspace_invitations')
      .insert({
        workspace_id: ctx.workspace.id,
        invited_by: ctx.session.user.id,
        invitee_telegram_username: parsed.data.inviteeUsername ?? null,
        role: parsed.data.role,
        token_hash: tokenHash,
        max_uses: parsed.data.maxUses,
        expires_at: expiresAt,
      })
      .select('id, role, expires_at')
      .single();

    if (error || !data) throw new Error(`Failed to create invitation: ${error?.message ?? 'unknown'}`);

    sendJson(res, 201, {
      invitationId: data.id,
      inviteToken: rawToken,
      role: data.role,
      expiresAt: data.expires_at,
    });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/workspaces/invitations/accept — Join family workspace via token
  // --------------------------------------------------------------------------
  if (route.section === 'accept' && req.method === 'POST') {
    const env = getServerEnv();
    const supabase = getSupabaseAdmin();
    const clientIp = getClientIp(req);
    const userAgent =
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

    const rawSessionToken = extractSessionToken(req);
    if (!rawSessionToken) throw new UnauthorizedError('Authentication required');

    const session = await loadSessionContextByToken({
      supabase,
      rawToken: rawSessionToken,
      sessionSecret: env.SESSION_SECRET,
    });

    await enforceRateLimit({
      supabase,
      bucketKey: `invite:accept:${session.user.id}:${clientIp}`,
      limit: 10,
      windowSeconds: 60,
    });

    const parsed = AcceptInviteSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) throw new ValidationError('Invalid invitation token');

    const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');

    const { data: invite } = await supabase
      .from('workspace_invitations')
      .select(
        'id, workspace_id, role, invitee_telegram_username, status, max_uses, use_count, expires_at',
      )
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (!invite || invite.status !== 'pending') {
      throw new NotFoundError('Invitation is invalid or no longer active');
    }
    if (new Date(invite.expires_at as string).getTime() <= Date.now()) {
      throw new ConflictError('Invitation has expired');
    }
    if (Number(invite.use_count) >= Number(invite.max_uses)) {
      throw new ConflictError('Invitation usage limit reached');
    }

    if (invite.invitee_telegram_username) {
      const expectedUser = String(invite.invitee_telegram_username).replace(/^@/, '').toLowerCase();
      const actualUser = (session.user.username ?? '').replace(/^@/, '').toLowerCase();
      if (!actualUser || actualUser !== expectedUser) {
        throw new ForbiddenError('This invitation is restricted to another Telegram username');
      }
    }

    const { data: existingMembership } = await supabase
      .from('workspace_members')
      .select('id, role')
      .eq('workspace_id', invite.workspace_id)
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (existingMembership) {
      throw new ConflictError('You are already a member of this workspace');
    }

    await supabase.from('workspace_members').insert({
      workspace_id: invite.workspace_id,
      user_id: session.user.id,
      role: invite.role,
    });

    const nextUses = Number(invite.use_count) + 1;
    await supabase
      .from('workspace_invitations')
      .update({
        use_count: nextUses,
        status: nextUses >= Number(invite.max_uses) ? 'accepted' : 'pending',
        accepted_by: session.user.id,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', invite.id);

    await recordAuditLog(supabase, {
      workspaceId: invite.workspace_id as string,
      actorUserId: session.user.id,
      action: 'workspace.invitation_accepted',
      entityType: 'workspace_invitation',
      entityId: invite.id as string,
      ipAddress: clientIp,
      userAgent,
      metadata: { role: invite.role },
    });

    sendJson(res, 200, { joinedWorkspaceId: invite.workspace_id, role: invite.role });
    return;
  }

  // --------------------------------------------------------------------------
  // GET/PATCH /api/workspaces/settings — Persist user & notification settings
  // --------------------------------------------------------------------------
  if (route.section === 'settings') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'workspaces:settings',
    });

    if (req.method === 'GET') {
      const { data: prefs } = await ctx.supabase
        .from('notification_preferences')
        .select(
          'telegram_enabled, budget_warnings, upcoming_payments, debt_reminders, goal_milestones, weekly_summary, monthly_summary',
        )
        .eq('user_id', ctx.session.user.id)
        .maybeSingle();

      sendJson(res, 200, {
        settings: ctx.session.settings,
        notificationPreferences: prefs ?? {
          telegram_enabled: true,
          budget_warnings: true,
          upcoming_payments: true,
          debt_reminders: true,
          goal_milestones: true,
          weekly_summary: true,
          monthly_summary: true,
        },
      });
      return;
    }

    if (req.method === 'PATCH') {
      const parsed = UpdateSettingsSchema.safeParse(parseJsonBody(req));
      if (!parsed.success) {
        throw new ValidationError('Invalid settings payload', {
          issues: parsed.error.flatten().fieldErrors,
        });
      }

      const settingsUpdate: Record<string, unknown> = {};
      if (parsed.data.language !== undefined) settingsUpdate.language = parsed.data.language;
      if (parsed.data.theme !== undefined) settingsUpdate.theme = parsed.data.theme;
      if (parsed.data.reportingCurrency !== undefined) {
        settingsUpdate.reporting_currency = normalizeCurrencyCode(parsed.data.reportingCurrency);
      }
      if (parsed.data.timezone !== undefined) settingsUpdate.timezone = parsed.data.timezone;
      if (parsed.data.hideBalances !== undefined) {
        settingsUpdate.hide_balances = parsed.data.hideBalances;
      }

      if (Object.keys(settingsUpdate).length > 0) {
        await ctx.supabase
          .from('user_settings')
          .update(settingsUpdate)
          .eq('user_id', ctx.session.user.id);
      }

      if (parsed.data.notificationPreferences) {
        const np = parsed.data.notificationPreferences;
        const npUpdate: Record<string, unknown> = {};
        if (np.telegramEnabled !== undefined) npUpdate.telegram_enabled = np.telegramEnabled;
        if (np.budgetWarnings !== undefined) npUpdate.budget_warnings = np.budgetWarnings;
        if (np.upcomingPayments !== undefined) npUpdate.upcoming_payments = np.upcomingPayments;
        if (np.debtReminders !== undefined) npUpdate.debt_reminders = np.debtReminders;
        if (np.goalMilestones !== undefined) npUpdate.goal_milestones = np.goalMilestones;
        if (np.weeklySummary !== undefined) npUpdate.weekly_summary = np.weeklySummary;
        if (np.monthlySummary !== undefined) npUpdate.monthly_summary = np.monthlySummary;

        if (Object.keys(npUpdate).length > 0) {
          await ctx.supabase
            .from('notification_preferences')
            .update(npUpdate)
            .eq('user_id', ctx.session.user.id);
        }
      }

      sendJson(res, 200, { updated: true });
      return;
    }

    throw new BadRequestError('Method not allowed');
  }

  // --------------------------------------------------------------------------
  // DELETE /api/workspaces/account — Account deactivation & session revocation
  // --------------------------------------------------------------------------
  if (route.section === 'account' && req.method === 'DELETE') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'workspaces:delete_account',
    });

    await Promise.all([
      ctx.supabase
        .from('users')
        .update({ is_active: false, deleted_at: new Date().toISOString() })
        .eq('id', ctx.session.user.id),
      ctx.supabase
        .from('sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', ctx.session.user.id),
    ]);

    sendJson(res, 200, { deleted: true });
    return;
  }

  throw new NotFoundError('Workspace endpoint not found');
});
