import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { parseJsonBody, sendJson, withApiHandler } from '../../server/http/response.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../server/security/errors.js';
import { recordAuditLog } from '../../server/security/audit.js';
import {
  ADMIN_ROLES,
  ALL_ROLES,
  authenticateFinanceRequest,
  canUserAccessAccount,
  WRITE_ROLES,
  type AccountAccessRecord,
} from '../../server/finance/access.js';
import {
  convertMoney,
  formatMoneyFixed4,
  normalizeCurrencyCode,
  parseMoney,
} from '../../server/finance/money.js';
import {
  fetchWorkspaceExchangeRates,
  resolveRateFromRows,
} from '../../server/finance/exchangeRates.js';

const CreateAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z
    .enum(['cash', 'bank_card', 'bank_account', 'savings', 'investment', 'e_wallet', 'credit', 'other'])
    .default('cash'),
  currency: z.string().trim().length(3),
  openingBalance: z.union([z.string(), z.number()]).default('0'),
  visibility: z.enum(['workspace', 'private', 'selected_members']).default('workspace'),
  allowedMemberIds: z.array(z.string().uuid()).default([]),
  color: z.string().max(32).optional().nullable(),
  icon: z.string().max(40).optional().nullable(),
  includeInNetWorth: z.boolean().default(true),
});

const UpdateAccountSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  type: z
    .enum(['cash', 'bank_card', 'bank_account', 'savings', 'investment', 'e_wallet', 'credit', 'other'])
    .optional(),
  visibility: z.enum(['workspace', 'private', 'selected_members']).optional(),
  allowedMemberIds: z.array(z.string().uuid()).optional(),
  color: z.string().max(32).optional().nullable(),
  icon: z.string().max(40).optional().nullable(),
  includeInNetWorth: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

const CreateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['income', 'expense', 'both']),
  icon: z.string().max(40).optional().nullable(),
  color: z.string().max(32).optional().nullable(),
});

function resolveSubRoute(req: VercelRequest): { segment: string; id: string | null } {
  const qSub = typeof req.query.sub === 'string' ? req.query.sub.trim() : '';
  if (qSub) {
    if (qSub === 'reconcile' || qSub === 'categories') {
      return { segment: qSub, id: null };
    }
    return { segment: 'item', id: qSub };
  }
  const pathname = (req.url ?? '').split('?')[0];
  const parts = pathname.split('/').filter(Boolean); // ['api', 'accounts', ...]
  const third = parts[2] ?? '';
  if (!third) return { segment: 'root', id: null };
  if (third === 'reconcile' || third === 'categories') {
    return { segment: third, id: null };
  }
  return { segment: 'item', id: third };
}

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  const { segment, id } = resolveSubRoute(req);

  // --------------------------------------------------------------------------
  // GET /api/accounts/reconcile — Run deterministic ledger reconciliation RPC
  // --------------------------------------------------------------------------
  if (segment === 'reconcile') {
    if (req.method !== 'GET') throw new BadRequestError('Use GET for /api/accounts/reconcile');

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'accounts:reconcile',
    });

    const [{ data: rows, error }, { data: accountRows }] = await Promise.all([
      ctx.supabase.rpc('reconcile_workspace_accounts', {
        p_workspace_id: ctx.workspace.id,
      }),
      ctx.supabase
        .from('accounts')
        .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids')
        .eq('workspace_id', ctx.workspace.id),
    ]);

    if (error) {
      throw new Error(`Reconciliation failed: ${error.message}`);
    }

    const accessMap = new Map<string, AccountAccessRecord>(
      ((accountRows ?? []) as AccountAccessRecord[]).map((a) => [a.id, a]),
    );

    const visibleRows = ((rows ?? []) as Array<Record<string, unknown>>).filter((r) => {
      const acc = accessMap.get(String(r.account_id));
      return acc ? canUserAccessAccount(acc, ctx.session.user.id, ctx.workspace.id) : false;
    });

    const allBalanced = visibleRows.every((r) => Boolean(r.is_balanced));

    sendJson(res, 200, {
      workspaceId: ctx.workspace.id,
      checkedAt: new Date().toISOString(),
      allBalanced,
      accounts: visibleRows.map((r) => ({
        accountId: r.account_id,
        accountName: r.account_name,
        currency: r.currency,
        openingBalance: String(r.opening_balance),
        ledgerNetSum: String(r.ledger_net_sum),
        expectedBalance: String(r.expected_balance),
        recordedBalance: String(r.recorded_balance),
        discrepancy: String(r.discrepancy),
        isBalanced: Boolean(r.is_balanced),
        entryCount: Number(r.entry_count),
      })),
    });
    return;
  }

  // --------------------------------------------------------------------------
  // GET/POST /api/accounts/categories — Workspace categories
  // --------------------------------------------------------------------------
  if (segment === 'categories') {
    if (req.method === 'GET') {
      const ctx = await authenticateFinanceRequest(req, {
        allowedRoles: ALL_ROLES,
        rateLimitKey: 'categories:list',
      });

      const { data, error } = await ctx.supabase
        .from('categories')
        .select('id, name, name_uz, name_ru, name_en, type, icon, color, is_system, is_archived, sort_order')
        .eq('workspace_id', ctx.workspace.id)
        .eq('is_archived', false)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw new Error(`Failed to fetch categories: ${error.message}`);
      sendJson(res, 200, { categories: data ?? [] });
      return;
    }

    if (req.method === 'POST') {
      const ctx = await authenticateFinanceRequest(req, {
        allowedRoles: WRITE_ROLES,
        rateLimitKey: 'categories:create',
      });

      const parsed = CreateCategorySchema.safeParse(parseJsonBody(req));
      if (!parsed.success) {
        throw new ValidationError('Invalid category input', {
          issues: parsed.error.flatten().fieldErrors,
        });
      }

      const { data, error } = await ctx.supabase
        .from('categories')
        .insert({
          workspace_id: ctx.workspace.id,
          name: parsed.data.name,
          name_uz: parsed.data.name,
          name_ru: parsed.data.name,
          name_en: parsed.data.name,
          type: parsed.data.type,
          icon: parsed.data.icon ?? 'tag',
          color: parsed.data.color ?? '#3B82F6',
          is_system: false,
        })
        .select('id, name, name_uz, name_ru, name_en, type, icon, color, is_system, sort_order')
        .single();

      if (error || !data) {
        throw new Error(`Failed to create category: ${error?.message ?? 'unknown'}`);
      }

      await recordAuditLog(ctx.supabase, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.session.user.id,
        action: 'category.created',
        entityType: 'category',
        entityId: data.id as string,
        ipAddress: ctx.clientIp,
        userAgent: ctx.userAgent,
      });

      sendJson(res, 201, { category: data });
      return;
    }

    throw new BadRequestError('Method not allowed for /api/accounts/categories');
  }

  // --------------------------------------------------------------------------
  // GET /api/accounts — List authorized accounts + consolidated reporting totals
  // --------------------------------------------------------------------------
  if (segment === 'root' && req.method === 'GET') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'accounts:list',
    });

    const includeArchived = req.query.includeArchived === 'true';
    const reportingCurrency = normalizeCurrencyCode(
      typeof req.query.reportingCurrency === 'string' && req.query.reportingCurrency.trim().length === 3
        ? req.query.reportingCurrency
        : ctx.session.settings.reportingCurrency || ctx.workspace.defaultCurrency,
    );

    let query = ctx.supabase
      .from('accounts')
      .select(
        'id, workspace_id, owner_user_id, name, type, currency, opening_balance, current_balance, visibility, allowed_member_ids, color, icon, include_in_net_worth, is_archived, created_at, updated_at',
      )
      .eq('workspace_id', ctx.workspace.id)
      .order('is_archived', { ascending: true })
      .order('created_at', { ascending: true });

    if (!includeArchived) {
      query = query.eq('is_archived', false);
    }

    const [{ data: rawAccounts, error }, rateRows] = await Promise.all([
      query,
      fetchWorkspaceExchangeRates(ctx.supabase, ctx.workspace.id),
    ]);

    if (error) {
      throw new Error(`Failed to load accounts: ${error.message}`);
    }

    const visibleAccounts = ((rawAccounts ?? []) as Array<
      AccountAccessRecord & {
        name: string;
        type: string;
        currency: string;
        opening_balance: string | number;
        current_balance: string | number;
        color: string | null;
        icon: string | null;
        include_in_net_worth: boolean;
        is_archived: boolean;
        created_at: string;
        updated_at: string;
      }
    >).filter((acc) => canUserAccessAccount(acc, ctx.session.user.id, ctx.workspace.id));

    let totalBalanceDec = new Decimal(0);
    let netWorthDec = new Decimal(0);
    let hasOutdatedRates = false;
    let missingRateCurrencies: string[] = [];

    const enriched = visibleAccounts.map((acc) => {
      const currentBalance = formatMoneyFixed4(acc.current_balance);
      const openingBalance = formatMoneyFixed4(acc.opening_balance);
      const resolvedRate = resolveRateFromRows({
        rows: rateRows,
        baseCurrency: acc.currency,
        quoteCurrency: reportingCurrency,
        workspaceId: ctx.workspace.id,
      });

      let convertedBalance: string | null = null;
      if (resolvedRate) {
        convertedBalance = convertMoney(currentBalance, resolvedRate.rate);
        if (resolvedRate.isOutdated) hasOutdatedRates = true;
        if (!acc.is_archived) {
          totalBalanceDec = totalBalanceDec.plus(convertedBalance);
          if (acc.include_in_net_worth) {
            netWorthDec = netWorthDec.plus(convertedBalance);
          }
        }
      } else if (!missingRateCurrencies.includes(acc.currency)) {
        missingRateCurrencies.push(acc.currency);
      }

      return {
        id: acc.id,
        workspaceId: acc.workspace_id,
        ownerUserId: acc.owner_user_id,
        name: acc.name,
        type: acc.type,
        currency: acc.currency,
        openingBalance,
        currentBalance,
        reportingCurrency,
        convertedBalance,
        exchangeRate: resolvedRate,
        visibility: acc.visibility,
        allowedMemberIds: acc.allowed_member_ids ?? [],
        color: acc.color,
        icon: acc.icon,
        includeInNetWorth: acc.include_in_net_worth,
        isArchived: acc.is_archived,
        createdAt: acc.created_at,
        updatedAt: acc.updated_at,
      };
    });

    sendJson(res, 200, {
      workspaceId: ctx.workspace.id,
      reportingCurrency,
      summary: {
        totalBalance: formatMoneyFixed4(totalBalanceDec),
        netWorth: formatMoneyFixed4(netWorthDec),
        hasOutdatedRates,
        missingRateCurrencies,
        accountCount: enriched.filter((a) => !a.isArchived).length,
      },
      accounts: enriched,
    });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/accounts — Create new account (decimal-safe opening balance)
  // --------------------------------------------------------------------------
  if (segment === 'root' && req.method === 'POST') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'accounts:create',
    });

    const parsed = CreateAccountSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid account payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const currency = normalizeCurrencyCode(parsed.data.currency);
    const opening = formatMoneyFixed4(parseMoney(parsed.data.openingBalance, 'openingBalance'));

    const { data, error } = await ctx.supabase
      .from('accounts')
      .insert({
        workspace_id: ctx.workspace.id,
        owner_user_id: ctx.session.user.id,
        name: parsed.data.name,
        type: parsed.data.type,
        currency,
        opening_balance: opening,
        current_balance: opening,
        visibility: parsed.data.visibility,
        allowed_member_ids:
          parsed.data.visibility === 'selected_members' ? parsed.data.allowedMemberIds : [],
        color: parsed.data.color ?? '#3B82F6',
        icon: parsed.data.icon ?? 'wallet',
        include_in_net_worth: parsed.data.includeInNetWorth,
      })
      .select(
        'id, workspace_id, owner_user_id, name, type, currency, opening_balance, current_balance, visibility, allowed_member_ids, color, icon, include_in_net_worth, is_archived, created_at, updated_at',
      )
      .single();

    if (error || !data) {
      throw new Error(`Failed to create account: ${error?.message ?? 'unknown'}`);
    }

    await recordAuditLog(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.session.user.id,
      action: 'account.created',
      entityType: 'account',
      entityId: data.id as string,
      ipAddress: ctx.clientIp,
      userAgent: ctx.userAgent,
      metadata: { currency, type: parsed.data.type, openingBalance: opening },
    });

    sendJson(res, 201, {
      account: {
        id: data.id,
        workspaceId: data.workspace_id,
        ownerUserId: data.owner_user_id,
        name: data.name,
        type: data.type,
        currency: data.currency,
        openingBalance: formatMoneyFixed4(data.opening_balance as string | number),
        currentBalance: formatMoneyFixed4(data.current_balance as string | number),
        visibility: data.visibility,
        allowedMemberIds: data.allowed_member_ids ?? [],
        color: data.color,
        icon: data.icon,
        includeInNetWorth: data.include_in_net_worth,
        isArchived: data.is_archived,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    });
    return;
  }

  // --------------------------------------------------------------------------
  // PATCH /api/accounts/:id — Update account metadata or archive state
  // --------------------------------------------------------------------------
  if (segment === 'item' && id && req.method === 'PATCH') {
    if (!z.string().uuid().safeParse(id).success) {
      throw new BadRequestError('Invalid account ID');
    }

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'accounts:update',
    });

    const parsed = UpdateAccountSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid account update payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const { data: existing, error: fetchErr } = await ctx.supabase
      .from('accounts')
      .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids')
      .eq('id', id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (fetchErr || !existing) {
      throw new NotFoundError('Account not found');
    }

    const isOwner = existing.owner_user_id === ctx.session.user.id;
    const isAdmin = ADMIN_ROLES.includes(ctx.workspace.role);
    if (!isOwner && (existing.visibility === 'private' || !isAdmin)) {
      throw new ForbiddenError('Only the account owner or a workspace admin can update this account');
    }

    const updatePayload: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updatePayload.name = parsed.data.name;
    if (parsed.data.type !== undefined) updatePayload.type = parsed.data.type;
    if (parsed.data.visibility !== undefined) updatePayload.visibility = parsed.data.visibility;
    if (parsed.data.allowedMemberIds !== undefined) {
      updatePayload.allowed_member_ids = parsed.data.allowedMemberIds;
    }
    if (parsed.data.color !== undefined) updatePayload.color = parsed.data.color;
    if (parsed.data.icon !== undefined) updatePayload.icon = parsed.data.icon;
    if (parsed.data.includeInNetWorth !== undefined) {
      updatePayload.include_in_net_worth = parsed.data.includeInNetWorth;
    }
    if (parsed.data.isArchived !== undefined) updatePayload.is_archived = parsed.data.isArchived;

    if (Object.keys(updatePayload).length === 0) {
      throw new BadRequestError('No fields provided to update');
    }

    const { data: updated, error: updateErr } = await ctx.supabase
      .from('accounts')
      .update(updatePayload)
      .eq('id', id)
      .eq('workspace_id', ctx.workspace.id)
      .select(
        'id, workspace_id, owner_user_id, name, type, currency, opening_balance, current_balance, visibility, allowed_member_ids, color, icon, include_in_net_worth, is_archived, created_at, updated_at',
      )
      .single();

    if (updateErr || !updated) {
      throw new Error(`Failed to update account: ${updateErr?.message ?? 'unknown'}`);
    }

    await recordAuditLog(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.session.user.id,
      action: 'account.updated',
      entityType: 'account',
      entityId: id,
      ipAddress: ctx.clientIp,
      userAgent: ctx.userAgent,
      metadata: { updatedFields: Object.keys(updatePayload) },
    });

    sendJson(res, 200, {
      account: {
        id: updated.id,
        workspaceId: updated.workspace_id,
        ownerUserId: updated.owner_user_id,
        name: updated.name,
        type: updated.type,
        currency: updated.currency,
        openingBalance: formatMoneyFixed4(updated.opening_balance as string | number),
        currentBalance: formatMoneyFixed4(updated.current_balance as string | number),
        visibility: updated.visibility,
        allowedMemberIds: updated.allowed_member_ids ?? [],
        color: updated.color,
        icon: updated.icon,
        includeInNetWorth: updated.include_in_net_worth,
        isArchived: updated.is_archived,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    });
    return;
  }

  throw new NotFoundError('Account endpoint not found');
});
