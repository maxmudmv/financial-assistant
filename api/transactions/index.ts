import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { parseJsonBody, sendJson, withApiHandler } from '../../server/http/response.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../server/security/errors.js';
import { recordAuditLog } from '../../server/security/audit.js';
import {
  ALL_ROLES,
  assertAccountAccessible,
  authenticateFinanceRequest,
  canUserAccessAccount,
  canUserMutateTransaction,
  canUserViewTransaction,
  WRITE_ROLES,
  type AccountAccessRecord,
  type TransactionAccessRecord,
} from '../../server/finance/access.js';
import {
  convertMoney,
  formatMoneyFixed4,
  normalizeCurrencyCode,
  parsePositiveMoney,
} from '../../server/finance/money.js';
import {
  fetchWorkspaceExchangeRates,
  resolveRateFromRows,
} from '../../server/finance/exchangeRates.js';
import {
  checkApiIdempotency,
  computeRequestPayloadHash,
  storeApiIdempotency,
} from '../../server/finance/idempotency.js';

const CreateTransactionSchema = z.object({
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().optional().nullable(),
  type: z.enum([
    'income',
    'expense',
    'refund',
    'adjustment',
    'savings_contribution',
    'savings_withdrawal',
    'debt_repayment',
  ]),
  adjustmentDirection: z.enum(['credit', 'debit']).default('credit'),
  amount: z.union([z.string(), z.number()]),
  occurredAt: z.string().datetime().optional(),
  description: z.string().trim().max(240).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(32)).max(10).default([]),
  isPrivate: z.boolean().default(false),
});

const EditTransactionSchema = CreateTransactionSchema;

function resolveSubRoute(req: VercelRequest): {
  mode: 'root' | 'ledger' | 'detail' | 'void';
  id: string | null;
} {
  const qSub = typeof req.query.sub === 'string' ? req.query.sub.trim() : '';
  const qAction = typeof req.query.action === 'string' ? req.query.action.trim() : '';
  if (qSub === 'ledger') return { mode: 'ledger', id: null };
  if (qSub && qAction === 'void') return { mode: 'void', id: qSub };
  if (qSub) return { mode: 'detail', id: qSub };

  const pathname = (req.url ?? '').split('?')[0];
  const parts = pathname.split('/').filter(Boolean); // ['api', 'transactions', ...]
  if (!parts[2]) return { mode: 'root', id: null };
  if (parts[2] === 'ledger') return { mode: 'ledger', id: null };
  if (parts[3] === 'void') return { mode: 'void', id: parts[2] };
  return { mode: 'detail', id: parts[2] };
}

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  const route = resolveSubRoute(req);

  // --------------------------------------------------------------------------
  // GET /api/transactions/ledger — Immutable ledger audit stream
  // --------------------------------------------------------------------------
  if (route.mode === 'ledger') {
    if (req.method !== 'GET') throw new BadRequestError('Use GET for /api/transactions/ledger');

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'transactions:ledger',
    });

    const accountId =
      typeof req.query.accountId === 'string' && z.string().uuid().safeParse(req.query.accountId).success
        ? req.query.accountId
        : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const { data: accounts } = await ctx.supabase
      .from('accounts')
      .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, name')
      .eq('workspace_id', ctx.workspace.id);

    const accessibleAccounts = new Map(
      ((accounts ?? []) as Array<AccountAccessRecord & { name: string }>)
        .filter((a) => canUserAccessAccount(a, ctx.session.user.id, ctx.workspace.id))
        .map((a) => [a.id, a]),
    );

    if (accountId && !accessibleAccounts.has(accountId)) {
      throw new ForbiddenError('Access to requested account ledger is denied');
    }

    let query = ctx.supabase
      .from('ledger_entries')
      .select(
        'id, transaction_id, account_id, entry_group_id, direction, amount, signed_amount, currency, balance_after, is_reversal, reversed_entry_id, occurred_at, created_by, created_at, transaction:transactions!inner(id, type, status, description, is_private, created_by)',
      )
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch ledger entries: ${error.message}`);

    const entries = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => {
        if (!accessibleAccounts.has(String(row.account_id))) return false;
        const tx = Array.isArray(row.transaction) ? row.transaction[0] : row.transaction;
        if (
          tx &&
          typeof tx === 'object' &&
          'is_private' in tx &&
          (tx as { is_private: boolean; created_by: string }).is_private &&
          (tx as { created_by: string }).created_by !== ctx.session.user.id
        ) {
          return false;
        }
        return true;
      })
      .map((row) => ({
        id: row.id,
        transactionId: row.transaction_id,
        accountId: row.account_id,
        accountName: accessibleAccounts.get(String(row.account_id))?.name ?? '',
        entryGroupId: row.entry_group_id,
        direction: row.direction,
        amount: formatMoneyFixed4(row.amount as string | number),
        signedAmount: formatMoneyFixed4(row.signed_amount as string | number),
        currency: row.currency,
        balanceAfter: formatMoneyFixed4(row.balance_after as string | number),
        isReversal: Boolean(row.is_reversal),
        reversedEntryId: row.reversed_entry_id,
        occurredAt: row.occurred_at,
        createdAt: row.created_at,
      }));

    sendJson(res, 200, { entries });
    return;
  }

  // --------------------------------------------------------------------------
  // GET /api/transactions — Filtered, searched, sorted transaction listing
  // --------------------------------------------------------------------------
  if (route.mode === 'root' && req.method === 'GET') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'transactions:list',
    });

    const { data: accounts } = await ctx.supabase
      .from('accounts')
      .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, name, currency')
      .eq('workspace_id', ctx.workspace.id);

    const accessibleAccounts = new Map(
      ((accounts ?? []) as Array<AccountAccessRecord & { name: string; currency: string }>)
        .filter((a) => canUserAccessAccount(a, ctx.session.user.id, ctx.workspace.id))
        .map((a) => [a.id, a]),
    );

    const accountIds = Array.from(accessibleAccounts.keys());
    if (accountIds.length === 0) {
      sendJson(res, 200, { transactions: [], total: 0 });
      return;
    }

    const filterAccountId =
      typeof req.query.accountId === 'string' && z.string().uuid().safeParse(req.query.accountId).success
        ? req.query.accountId
        : null;
    if (filterAccountId && !accessibleAccounts.has(filterAccountId)) {
      throw new ForbiddenError('Access to requested account is denied');
    }

    const filterCategoryId =
      typeof req.query.categoryId === 'string' && z.string().uuid().safeParse(req.query.categoryId).success
        ? req.query.categoryId
        : null;
    const filterType = typeof req.query.type === 'string' ? req.query.type.trim() : null;
    const filterStatus = typeof req.query.status === 'string' ? req.query.status.trim() : null;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const dateFrom = typeof req.query.from === 'string' ? req.query.from : null;
    const dateTo = typeof req.query.to === 'string' ? req.query.to : null;
    const sortBy = req.query.sortBy === 'amount' ? 'amount' : 'occurred_at';
    const sortOrder = req.query.sortOrder === 'asc';
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    let query = ctx.supabase
      .from('transactions')
      .select(
        'id, workspace_id, account_id, category_id, created_by, type, status, amount, currency, reporting_currency, exchange_rate_used, reporting_amount, occurred_at, description, notes, tags, is_private, transfer_id, created_at, updated_at, category:categories(id, name, name_uz, name_ru, name_en, icon, color)',
      )
      .eq('workspace_id', ctx.workspace.id)
      .in('account_id', filterAccountId ? [filterAccountId] : accountIds)
      .order(sortBy, { ascending: sortOrder })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (filterCategoryId) query = query.eq('category_id', filterCategoryId);
    if (filterType && filterType !== 'all') query = query.eq('type', filterType);
    if (filterStatus && filterStatus !== 'all') query = query.eq('status', filterStatus);
    if (dateFrom) query = query.gte('occurred_at', dateFrom);
    if (dateTo) query = query.lte('occurred_at', dateTo);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch transactions: ${error.message}`);

    const filtered = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => {
        const acc = accessibleAccounts.get(String(row.account_id));
        if (!acc) return false;
        const allowed = canUserViewTransaction(
          {
            id: String(row.id),
            workspace_id: String(row.workspace_id),
            account_id: String(row.account_id),
            created_by: String(row.created_by),
            is_private: Boolean(row.is_private),
          },
          acc,
          ctx.session.user.id,
          ctx.workspace.id,
        );
        if (!allowed) return false;

        if (search) {
          const desc = String(row.description ?? '').toLowerCase();
          const notes = String(row.notes ?? '').toLowerCase();
          const tags = Array.isArray(row.tags) ? (row.tags as string[]).join(' ').toLowerCase() : '';
          if (!desc.includes(search) && !notes.includes(search) && !tags.includes(search)) {
            return false;
          }
        }
        return true;
      })
      .map((row) => {
        const cat = Array.isArray(row.category) ? row.category[0] : row.category;
        return {
          id: row.id,
          workspaceId: row.workspace_id,
          accountId: row.account_id,
          accountName: accessibleAccounts.get(String(row.account_id))?.name ?? '',
          categoryId: row.category_id,
          category: cat ?? null,
          createdBy: row.created_by,
          type: row.type,
          status: row.status,
          amount: formatMoneyFixed4(row.amount as string | number),
          currency: row.currency,
          reportingCurrency: row.reporting_currency,
          exchangeRateUsed: row.exchange_rate_used ? String(row.exchange_rate_used) : null,
          reportingAmount: row.reporting_amount
            ? formatMoneyFixed4(row.reporting_amount as string | number)
            : null,
          occurredAt: row.occurred_at,
          description: row.description,
          notes: row.notes,
          tags: row.tags ?? [],
          isPrivate: Boolean(row.is_private),
          transferId: row.transfer_id,
          createdAt: row.created_at,
        };
      });

    sendJson(res, 200, {
      transactions: filtered,
      total: filtered.length,
    });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/transactions — Atomic idempotent transaction posting + FX snapshot
  // --------------------------------------------------------------------------
  if (route.mode === 'root' && req.method === 'POST') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'transactions:create',
    });

    const rawBody = parseJsonBody(req);
    const parsed = CreateTransactionSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new ValidationError('Invalid transaction payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const amount = formatMoneyFixed4(parsePositiveMoney(parsed.data.amount, 'amount'));
    const requestHash = computeRequestPayloadHash({ ...parsed.data, amount });

    if (ctx.idempotencyKey) {
      const cached = await checkApiIdempotency({
        supabase: ctx.supabase,
        userId: ctx.session.user.id,
        idempotencyKey: ctx.idempotencyKey,
        requestPath: '/api/transactions',
        requestHash,
      });
      if (cached.hit) {
        sendJson(res, cached.statusCode ?? 200, cached.responseBody);
        return;
      }
    }

    const { data: accountRow } = await ctx.supabase
      .from('accounts')
      .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, currency, is_archived')
      .eq('id', parsed.data.accountId)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!accountRow) {
      throw new NotFoundError('Account not found in workspace');
    }

    assertAccountAccessible(
      accountRow as AccountAccessRecord,
      ctx.session.user.id,
      ctx.workspace.id,
    );

    if (accountRow.is_archived) {
      throw new ValidationError('Cannot post transactions to an archived account');
    }

    // Preserve historical exchange-rate snapshot in reporting currency (never retroactively altered)
    const reportingCurrency = normalizeCurrencyCode(
      ctx.session.settings.reportingCurrency || ctx.workspace.defaultCurrency,
    );
    const occurredAt = parsed.data.occurredAt ?? new Date().toISOString();
    const rateRows = await fetchWorkspaceExchangeRates(ctx.supabase, ctx.workspace.id);
    const resolvedRate = resolveRateFromRows({
      rows: rateRows,
      baseCurrency: accountRow.currency as string,
      quoteCurrency: reportingCurrency,
      workspaceId: ctx.workspace.id,
      asOfDate: new Date(occurredAt),
    });

    const reportingAmount = resolvedRate ? convertMoney(amount, resolvedRate.rate) : null;

    const { data: rpcRows, error: rpcErr } = await ctx.supabase.rpc('post_transaction_atomic', {
      p_workspace_id: ctx.workspace.id,
      p_account_id: parsed.data.accountId,
      p_category_id: parsed.data.categoryId ?? null,
      p_created_by: ctx.session.user.id,
      p_type: parsed.data.type,
      p_amount: amount,
      p_reporting_currency: reportingCurrency,
      p_exchange_rate_used: resolvedRate?.rate ?? null,
      p_reporting_amount: reportingAmount,
      p_exchange_rate_id: resolvedRate?.rateId ?? null,
      p_occurred_at: occurredAt,
      p_description: parsed.data.description ?? null,
      p_notes: parsed.data.notes ?? null,
      p_tags: parsed.data.tags,
      p_is_private: parsed.data.isPrivate,
      p_idempotency_key: ctx.idempotencyKey,
      p_adjustment_direction: parsed.data.adjustmentDirection,
    });

    if (rpcErr || !Array.isArray(rpcRows) || rpcRows.length === 0) {
      throw new Error(`Atomic transaction post failed: ${rpcErr?.message ?? 'empty result'}`);
    }

    const result = rpcRows[0] as {
      transaction_id: string;
      ledger_entry_id: string;
      account_currency: string;
      new_balance: string | number;
      is_duplicate: boolean;
    };

    const responsePayload = {
      transactionId: result.transaction_id,
      ledgerEntryId: result.ledger_entry_id,
      accountCurrency: result.account_currency,
      newAccountBalance: formatMoneyFixed4(result.new_balance),
      reportingCurrency,
      reportingAmount,
      exchangeRateUsed: resolvedRate?.rate ?? null,
      isDuplicate: Boolean(result.is_duplicate),
    };

    if (ctx.idempotencyKey) {
      await storeApiIdempotency({
        supabase: ctx.supabase,
        workspaceId: ctx.workspace.id,
        userId: ctx.session.user.id,
        idempotencyKey: ctx.idempotencyKey,
        requestMethod: 'POST',
        requestPath: '/api/transactions',
        requestHash,
        responseStatus: result.is_duplicate ? 200 : 201,
        responseBody: responsePayload,
      });
    }

    if (!result.is_duplicate) {
      await recordAuditLog(ctx.supabase, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.session.user.id,
        action: 'transaction.posted',
        entityType: 'transaction',
        entityId: result.transaction_id,
        ipAddress: ctx.clientIp,
        userAgent: ctx.userAgent,
        metadata: { type: parsed.data.type, amount, currency: result.account_currency },
      });
    }

    sendJson(res, result.is_duplicate ? 200 : 201, responsePayload);
    return;
  }

  // --------------------------------------------------------------------------
  // GET /api/transactions/:id — Transaction details + immutable ledger history
  // --------------------------------------------------------------------------
  if (route.mode === 'detail' && route.id && req.method === 'GET') {
    if (!z.string().uuid().safeParse(route.id).success) {
      throw new BadRequestError('Invalid transaction ID');
    }

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'transactions:detail',
    });

    const { data: txRow, error } = await ctx.supabase
      .from('transactions')
      .select(
        'id, workspace_id, account_id, category_id, created_by, type, status, amount, currency, reporting_currency, exchange_rate_used, reporting_amount, occurred_at, description, notes, tags, is_private, transfer_id, created_at, updated_at, account:accounts!inner(id, workspace_id, owner_user_id, visibility, allowed_member_ids, name)',
      )
      .eq('id', route.id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (error || !txRow) {
      throw new NotFoundError('Transaction not found');
    }

    const acc = (Array.isArray(txRow.account) ? txRow.account[0] : txRow.account) as AccountAccessRecord & {
      name: string;
    };

    if (
      !canUserViewTransaction(
        txRow as unknown as TransactionAccessRecord,
        acc,
        ctx.session.user.id,
        ctx.workspace.id,
      )
    ) {
      throw new ForbiddenError('You do not have access to this transaction');
    }

    const { data: ledgerRows } = await ctx.supabase
      .from('ledger_entries')
      .select(
        'id, account_id, entry_group_id, direction, amount, signed_amount, currency, balance_after, is_reversal, reversed_entry_id, occurred_at, created_at',
      )
      .eq('transaction_id', route.id)
      .order('created_at', { ascending: true });

    sendJson(res, 200, {
      transaction: {
        id: txRow.id,
        workspaceId: txRow.workspace_id,
        accountId: txRow.account_id,
        accountName: acc.name,
        categoryId: txRow.category_id,
        type: txRow.type,
        status: txRow.status,
        amount: formatMoneyFixed4(txRow.amount as string | number),
        currency: txRow.currency,
        reportingCurrency: txRow.reporting_currency,
        exchangeRateUsed: txRow.exchange_rate_used ? String(txRow.exchange_rate_used) : null,
        reportingAmount: txRow.reporting_amount
          ? formatMoneyFixed4(txRow.reporting_amount as string | number)
          : null,
        occurredAt: txRow.occurred_at,
        description: txRow.description,
        notes: txRow.notes,
        tags: txRow.tags ?? [],
        isPrivate: Boolean(txRow.is_private),
        transferId: txRow.transfer_id,
        createdAt: txRow.created_at,
      },
      ledgerEntries: (ledgerRows ?? []).map((le) => ({
        id: le.id,
        accountId: le.account_id,
        entryGroupId: le.entry_group_id,
        direction: le.direction,
        amount: formatMoneyFixed4(le.amount as string | number),
        signedAmount: formatMoneyFixed4(le.signed_amount as string | number),
        currency: le.currency,
        balanceAfter: formatMoneyFixed4(le.balance_after as string | number),
        isReversal: Boolean(le.is_reversal),
        reversedEntryId: le.reversed_entry_id,
        occurredAt: le.occurred_at,
        createdAt: le.created_at,
      })),
    });
    return;
  }

  // --------------------------------------------------------------------------
  // PATCH /api/transactions/:id — Edit transaction (immutable reversal + repost)
  // --------------------------------------------------------------------------
  if (route.mode === 'detail' && route.id && req.method === 'PATCH') {
    if (!z.string().uuid().safeParse(route.id).success) {
      throw new BadRequestError('Invalid transaction ID');
    }

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'transactions:edit',
    });

    const parsed = EditTransactionSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid transaction edit payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const { data: existingTx } = await ctx.supabase
      .from('transactions')
      .select('id, workspace_id, account_id, created_by, is_private, status, type, occurred_at')
      .eq('id', route.id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!existingTx) throw new NotFoundError('Transaction not found');

    if (
      !canUserMutateTransaction(
        existingTx as TransactionAccessRecord,
        ctx.session.user.id,
        ctx.workspace.role,
      )
    ) {
      throw new ForbiddenError('You do not have permission to edit this transaction');
    }

    const { data: targetAccount } = await ctx.supabase
      .from('accounts')
      .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, currency, is_archived')
      .eq('id', parsed.data.accountId)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!targetAccount) {
      throw new NotFoundError('Target account not found in workspace');
    }

    assertAccountAccessible(
      targetAccount as AccountAccessRecord,
      ctx.session.user.id,
      ctx.workspace.id,
    );

    const amount = formatMoneyFixed4(parsePositiveMoney(parsed.data.amount, 'amount'));
    const reportingCurrency = normalizeCurrencyCode(
      ctx.session.settings.reportingCurrency || ctx.workspace.defaultCurrency,
    );
    const occurredAt = parsed.data.occurredAt ?? (existingTx.occurred_at as string);
    const rateRows = await fetchWorkspaceExchangeRates(ctx.supabase, ctx.workspace.id);
    const resolvedRate = resolveRateFromRows({
      rows: rateRows,
      baseCurrency: targetAccount.currency as string,
      quoteCurrency: reportingCurrency,
      workspaceId: ctx.workspace.id,
      asOfDate: new Date(occurredAt),
    });

    const { data: rpcRows, error: rpcErr } = await ctx.supabase.rpc('edit_transaction_atomic', {
      p_workspace_id: ctx.workspace.id,
      p_transaction_id: route.id,
      p_actor_user_id: ctx.session.user.id,
      p_account_id: parsed.data.accountId,
      p_category_id: parsed.data.categoryId ?? null,
      p_type: parsed.data.type,
      p_amount: amount,
      p_reporting_currency: reportingCurrency,
      p_exchange_rate_used: resolvedRate?.rate ?? null,
      p_reporting_amount: resolvedRate ? convertMoney(amount, resolvedRate.rate) : null,
      p_exchange_rate_id: resolvedRate?.rateId ?? null,
      p_occurred_at: occurredAt,
      p_description: parsed.data.description ?? null,
      p_notes: parsed.data.notes ?? null,
      p_tags: parsed.data.tags,
      p_is_private: parsed.data.isPrivate,
      p_adjustment_direction: parsed.data.adjustmentDirection,
    });

    if (rpcErr || !Array.isArray(rpcRows) || rpcRows.length === 0) {
      throw new BadRequestError(rpcErr?.message ?? 'Failed to edit transaction');
    }

    const row = rpcRows[0] as {
      transaction_id: string;
      new_account_balance: string | number;
      ledger_reposted: boolean;
    };

    await recordAuditLog(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.session.user.id,
      action: 'transaction.edited',
      entityType: 'transaction',
      entityId: route.id,
      ipAddress: ctx.clientIp,
      userAgent: ctx.userAgent,
      metadata: { ledgerReposted: Boolean(row.ledger_reposted), amount },
    });

    sendJson(res, 200, {
      transactionId: row.transaction_id,
      newAccountBalance: formatMoneyFixed4(row.new_account_balance),
      ledgerReposted: Boolean(row.ledger_reposted),
    });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/transactions/:id/void — Atomic append-only reversal
  // --------------------------------------------------------------------------
  if (route.mode === 'void' && route.id && req.method === 'POST') {
    if (!z.string().uuid().safeParse(route.id).success) {
      throw new BadRequestError('Invalid transaction ID');
    }

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'transactions:void',
    });

    const { data: existingTx } = await ctx.supabase
      .from('transactions')
      .select('id, workspace_id, account_id, created_by, is_private, status, type')
      .eq('id', route.id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!existingTx) throw new NotFoundError('Transaction not found');

    if (
      !canUserMutateTransaction(
        existingTx as TransactionAccessRecord,
        ctx.session.user.id,
        ctx.workspace.role,
      )
    ) {
      throw new ForbiddenError('You do not have permission to void this transaction');
    }

    const { data: rpcRows, error: rpcErr } = await ctx.supabase.rpc('void_transaction_atomic', {
      p_workspace_id: ctx.workspace.id,
      p_transaction_id: route.id,
      p_actor_user_id: ctx.session.user.id,
    });

    if (rpcErr || !Array.isArray(rpcRows) || rpcRows.length === 0) {
      throw new BadRequestError(rpcErr?.message ?? 'Failed to void transaction');
    }

    const row = rpcRows[0] as {
      transaction_id: string;
      reversal_entry_id: string;
      new_balance: string | number;
    };

    await recordAuditLog(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.session.user.id,
      action: 'transaction.voided',
      entityType: 'transaction',
      entityId: route.id,
      ipAddress: ctx.clientIp,
      userAgent: ctx.userAgent,
      metadata: { reversalEntryId: row.reversal_entry_id },
    });

    sendJson(res, 200, {
      transactionId: row.transaction_id,
      reversalEntryId: row.reversal_entry_id,
      newAccountBalance: formatMoneyFixed4(row.new_balance),
      status: 'voided',
    });
    return;
  }

  throw new NotFoundError('Transaction endpoint not found');
});
