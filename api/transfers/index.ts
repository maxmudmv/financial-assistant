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
  ADMIN_ROLES,
  ALL_ROLES,
  assertAccountAccessible,
  authenticateFinanceRequest,
  canUserAccessAccount,
  WRITE_ROLES,
  type AccountAccessRecord,
} from '../../server/finance/access.js';
import {
  computeBalancedTransfer,
  EXTENDED_ISO_4217_CURRENCIES,
  formatMoneyFixed4,
  formatRateFixed8,
  INITIAL_CURRENCIES,
  normalizeCurrencyCode,
} from '../../server/finance/money.js';
import {
  fetchWorkspaceExchangeRates,
  refreshFreeExchangeRates,
  resolveRateFromRows,
} from '../../server/finance/exchangeRates.js';
import {
  checkApiIdempotency,
  computeRequestPayloadHash,
  storeApiIdempotency,
} from '../../server/finance/idempotency.js';

const CreateTransferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  fromAmount: z.union([z.string(), z.number()]),
  toAmount: z.union([z.string(), z.number()]).optional(),
  exchangeRate: z.union([z.string(), z.number()]).optional(),
  feeAmount: z.union([z.string(), z.number()]).default('0'),
  occurredAt: z.string().datetime().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const ManualRateSchema = z.object({
  baseCurrency: z.string().trim().length(3),
  quoteCurrency: z.string().trim().length(3),
  rate: z.union([z.string(), z.number()]),
  effectiveAt: z.string().datetime().optional(),
});

function resolveSubRoute(req: VercelRequest): {
  mode: 'root' | 'void' | 'rates' | 'rates_refresh';
  id: string | null;
} {
  const qSub = typeof req.query.sub === 'string' ? req.query.sub.trim() : '';
  const qAction = typeof req.query.action === 'string' ? req.query.action.trim() : '';

  if (qSub === 'rates' && qAction === 'refresh') return { mode: 'rates_refresh', id: null };
  if (qSub === 'rates') return { mode: 'rates', id: null };
  if (qSub && qAction === 'void') return { mode: 'void', id: qSub };

  const pathname = (req.url ?? '').split('?')[0];
  const parts = pathname.split('/').filter(Boolean); // ['api', 'transfers', ...]
  if (!parts[2]) return { mode: 'root', id: null };
  if (parts[2] === 'rates' && parts[3] === 'refresh') return { mode: 'rates_refresh', id: null };
  if (parts[2] === 'rates') return { mode: 'rates', id: null };
  if (parts[3] === 'void') return { mode: 'void', id: parts[2] };
  return { mode: 'root', id: parts[2] };
}

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  const route = resolveSubRoute(req);

  // --------------------------------------------------------------------------
  // POST /api/transfers/rates/refresh — Zero-cost free FX provider refresh
  // --------------------------------------------------------------------------
  if (route.mode === 'rates_refresh') {
    if (req.method !== 'POST') {
      throw new BadRequestError('Use POST for /api/transfers/rates/refresh');
    }

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'fx:refresh',
      rateLimitMax: 10,
    });

    const refreshResult = await refreshFreeExchangeRates({
      supabase: ctx.supabase,
    });

    await recordAuditLog(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.session.user.id,
      action: 'exchange_rates.refreshed',
      entityType: 'exchange_rate',
      ipAddress: ctx.clientIp,
      userAgent: ctx.userAgent,
      metadata: {
        refreshed: refreshResult.refreshed,
        source: refreshResult.source,
        insertedCount: refreshResult.insertedCount,
      },
    });

    sendJson(res, 200, refreshResult);
    return;
  }

  // --------------------------------------------------------------------------
  // GET/POST /api/transfers/rates — Exchange rates, conversion preview & manual rates
  // --------------------------------------------------------------------------
  if (route.mode === 'rates') {
    if (req.method === 'GET') {
      const ctx = await authenticateFinanceRequest(req, {
        allowedRoles: ALL_ROLES,
        rateLimitKey: 'fx:list',
      });

      const rows = await fetchWorkspaceExchangeRates(ctx.supabase, ctx.workspace.id);
      const quoteCurrency = normalizeCurrencyCode(
        typeof req.query.quote === 'string' && req.query.quote.trim().length === 3
          ? req.query.quote
          : ctx.session.settings.reportingCurrency || ctx.workspace.defaultCurrency,
      );

      const baseQuery =
        typeof req.query.base === 'string' && req.query.base.trim().length === 3
          ? normalizeCurrencyCode(req.query.base)
          : null;

      if (baseQuery) {
        const resolved = resolveRateFromRows({
          rows,
          baseCurrency: baseQuery,
          quoteCurrency,
          workspaceId: ctx.workspace.id,
        });
        sendJson(res, 200, {
          pair: { baseCurrency: baseQuery, quoteCurrency },
          resolved,
        });
        return;
      }

      const matrix = INITIAL_CURRENCIES.filter((c) => c !== quoteCurrency).map((base) => ({
        baseCurrency: base,
        quoteCurrency,
        resolved: resolveRateFromRows({
          rows,
          baseCurrency: base,
          quoteCurrency,
          workspaceId: ctx.workspace.id,
        }),
      }));

      sendJson(res, 200, {
        quoteCurrency,
        initialCurrencies: INITIAL_CURRENCIES,
        supportedCurrencies: EXTENDED_ISO_4217_CURRENCIES,
        matrix,
        history: rows.slice(0, 40).map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          baseCurrency: r.base_currency,
          quoteCurrency: r.quote_currency,
          rate: String(r.rate),
          source: r.source,
          isManual: r.is_manual,
          effectiveAt: r.effective_at,
          fetchedAt: r.fetched_at,
        })),
      });
      return;
    }

    if (req.method === 'POST') {
      const ctx = await authenticateFinanceRequest(req, {
        allowedRoles: WRITE_ROLES,
        rateLimitKey: 'fx:manual',
      });

      const parsed = ManualRateSchema.safeParse(parseJsonBody(req));
      if (!parsed.success) {
        throw new ValidationError('Invalid manual exchange rate payload', {
          issues: parsed.error.flatten().fieldErrors,
        });
      }

      const baseCurrency = normalizeCurrencyCode(parsed.data.baseCurrency);
      const quoteCurrency = normalizeCurrencyCode(parsed.data.quoteCurrency);
      if (baseCurrency === quoteCurrency) {
        throw new ValidationError('Base and quote currencies must be different');
      }

      const formattedRate = formatRateFixed8(parsed.data.rate);
      const nowIso = new Date().toISOString();

      const { data, error } = await ctx.supabase
        .from('exchange_rates')
        .insert({
          workspace_id: ctx.workspace.id,
          base_currency: baseCurrency,
          quote_currency: quoteCurrency,
          rate: formattedRate,
          source: 'manual_user',
          is_manual: true,
          effective_at: parsed.data.effectiveAt ?? nowIso,
          fetched_at: nowIso,
          created_by: ctx.session.user.id,
        })
        .select('id, base_currency, quote_currency, rate, source, is_manual, effective_at, fetched_at')
        .single();

      if (error || !data) {
        throw new Error(`Failed to save manual exchange rate: ${error?.message ?? 'unknown'}`);
      }

      await recordAuditLog(ctx.supabase, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.session.user.id,
        action: 'exchange_rate.manual_created',
        entityType: 'exchange_rate',
        entityId: data.id as string,
        ipAddress: ctx.clientIp,
        userAgent: ctx.userAgent,
        metadata: { baseCurrency, quoteCurrency, rate: formattedRate },
      });

      sendJson(res, 201, {
        exchangeRate: {
          id: data.id,
          baseCurrency: data.base_currency,
          quoteCurrency: data.quote_currency,
          rate: String(data.rate),
          source: data.source,
          isManual: data.is_manual,
          effectiveAt: data.effective_at,
          fetchedAt: data.fetched_at,
        },
      });
      return;
    }

    throw new BadRequestError('Method not allowed for /api/transfers/rates');
  }

  // --------------------------------------------------------------------------
  // GET /api/transfers — List workspace transfers for accessible accounts
  // --------------------------------------------------------------------------
  if (route.mode === 'root' && req.method === 'GET') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'transfers:list',
    });

    const [{ data: accounts }, { data: transferRows, error }] = await Promise.all([
      ctx.supabase
        .from('accounts')
        .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, name, currency')
        .eq('workspace_id', ctx.workspace.id),
      ctx.supabase
        .from('transfers')
        .select(
          'id, workspace_id, created_by, from_account_id, to_account_id, from_amount, from_currency, to_amount, to_currency, exchange_rate, fee_amount, fee_currency, outgoing_transaction_id, incoming_transaction_id, occurred_at, notes, status, created_at',
        )
        .eq('workspace_id', ctx.workspace.id)
        .order('occurred_at', { ascending: false })
        .limit(100),
    ]);

    if (error) throw new Error(`Failed to fetch transfers: ${error.message}`);

    const accessibleAccounts = new Map(
      ((accounts ?? []) as Array<AccountAccessRecord & { name: string; currency: string }>)
        .filter((a) => canUserAccessAccount(a, ctx.session.user.id, ctx.workspace.id))
        .map((a) => [a.id, a]),
    );

    const visible = ((transferRows ?? []) as Array<Record<string, unknown>>)
      .filter(
        (tr) =>
          accessibleAccounts.has(String(tr.from_account_id)) &&
          accessibleAccounts.has(String(tr.to_account_id)),
      )
      .map((tr) => ({
        id: tr.id,
        fromAccountId: tr.from_account_id,
        fromAccountName: accessibleAccounts.get(String(tr.from_account_id))?.name ?? '',
        toAccountId: tr.to_account_id,
        toAccountName: accessibleAccounts.get(String(tr.to_account_id))?.name ?? '',
        fromAmount: formatMoneyFixed4(tr.from_amount as string | number),
        fromCurrency: tr.from_currency,
        toAmount: formatMoneyFixed4(tr.to_amount as string | number),
        toCurrency: tr.to_currency,
        exchangeRate: String(tr.exchange_rate),
        feeAmount: formatMoneyFixed4(tr.fee_amount as string | number),
        feeCurrency: tr.fee_currency,
        occurredAt: tr.occurred_at,
        notes: tr.notes,
        status: tr.status,
        createdAt: tr.created_at,
      }));

    sendJson(res, 200, { transfers: visible });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/transfers — Atomic balanced transfer posting
  // --------------------------------------------------------------------------
  if (route.mode === 'root' && req.method === 'POST') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'transfers:create',
    });

    const parsed = CreateTransferSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid transfer payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    if (parsed.data.fromAccountId === parsed.data.toAccountId) {
      throw new ValidationError('Source and destination accounts must be different');
    }

    const requestHash = computeRequestPayloadHash(parsed.data);
    if (ctx.idempotencyKey) {
      const cached = await checkApiIdempotency({
        supabase: ctx.supabase,
        userId: ctx.session.user.id,
        idempotencyKey: ctx.idempotencyKey,
        requestPath: '/api/transfers',
        requestHash,
      });
      if (cached.hit) {
        sendJson(res, cached.statusCode ?? 200, cached.responseBody);
        return;
      }
    }

    const { data: accRows } = await ctx.supabase
      .from('accounts')
      .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, currency, is_archived')
      .eq('workspace_id', ctx.workspace.id)
      .in('id', [parsed.data.fromAccountId, parsed.data.toAccountId]);

    const fromAcc = (accRows ?? []).find((a) => a.id === parsed.data.fromAccountId);
    const toAcc = (accRows ?? []).find((a) => a.id === parsed.data.toAccountId);

    if (!fromAcc || !toAcc) {
      throw new NotFoundError('One or both transfer accounts were not found in workspace');
    }

    assertAccountAccessible(
      fromAcc as AccountAccessRecord,
      ctx.session.user.id,
      ctx.workspace.id,
    );
    assertAccountAccessible(
      toAcc as AccountAccessRecord,
      ctx.session.user.id,
      ctx.workspace.id,
    );

    if (fromAcc.is_archived || toAcc.is_archived) {
      throw new ValidationError('Cannot transfer between archived accounts');
    }

    // If cross-currency and neither rate nor toAmount provided, resolve from cached FX rates
    let rateToUse = parsed.data.exchangeRate;
    if (
      fromAcc.currency !== toAcc.currency &&
      rateToUse === undefined &&
      parsed.data.toAmount === undefined
    ) {
      const rateRows = await fetchWorkspaceExchangeRates(ctx.supabase, ctx.workspace.id);
      const resolved = resolveRateFromRows({
        rows: rateRows,
        baseCurrency: fromAcc.currency as string,
        quoteCurrency: toAcc.currency as string,
        workspaceId: ctx.workspace.id,
      });
      if (!resolved) {
        throw new ValidationError(
          'No exchange rate available for this currency pair. Enter a manual rate or destination amount.',
        );
      }
      rateToUse = resolved.rate;
    }

    const balanced = computeBalancedTransfer({
      fromCurrency: fromAcc.currency as string,
      toCurrency: toAcc.currency as string,
      fromAmount: parsed.data.fromAmount,
      toAmount: parsed.data.toAmount,
      exchangeRate: rateToUse,
      feeAmount: parsed.data.feeAmount,
    });

    const { data: rpcRows, error: rpcErr } = await ctx.supabase.rpc('post_transfer_atomic', {
      p_workspace_id: ctx.workspace.id,
      p_created_by: ctx.session.user.id,
      p_from_account_id: parsed.data.fromAccountId,
      p_to_account_id: parsed.data.toAccountId,
      p_from_amount: balanced.fromAmount,
      p_to_amount: balanced.toAmount,
      p_exchange_rate: balanced.exchangeRate,
      p_fee_amount: balanced.feeAmount,
      p_occurred_at: parsed.data.occurredAt ?? new Date().toISOString(),
      p_notes: parsed.data.notes ?? null,
      p_idempotency_key: ctx.idempotencyKey,
    });

    if (rpcErr || !Array.isArray(rpcRows) || rpcRows.length === 0) {
      throw new BadRequestError(rpcErr?.message ?? 'Transfer execution failed');
    }

    const row = rpcRows[0] as {
      transfer_id: string;
      outgoing_transaction_id: string;
      incoming_transaction_id: string;
      from_new_balance: string | number;
      to_new_balance: string | number;
      is_duplicate: boolean;
    };

    const responsePayload = {
      transferId: row.transfer_id,
      outgoingTransactionId: row.outgoing_transaction_id,
      incomingTransactionId: row.incoming_transaction_id,
      fromAmount: balanced.fromAmount,
      fromCurrency: fromAcc.currency,
      toAmount: balanced.toAmount,
      toCurrency: toAcc.currency,
      exchangeRate: balanced.exchangeRate,
      feeAmount: balanced.feeAmount,
      fromNewBalance: formatMoneyFixed4(row.from_new_balance),
      toNewBalance: formatMoneyFixed4(row.to_new_balance),
      isDuplicate: Boolean(row.is_duplicate),
    };

    if (ctx.idempotencyKey) {
      await storeApiIdempotency({
        supabase: ctx.supabase,
        workspaceId: ctx.workspace.id,
        userId: ctx.session.user.id,
        idempotencyKey: ctx.idempotencyKey,
        requestMethod: 'POST',
        requestPath: '/api/transfers',
        requestHash,
        responseStatus: row.is_duplicate ? 200 : 201,
        responseBody: responsePayload,
      });
    }

    if (!row.is_duplicate) {
      await recordAuditLog(ctx.supabase, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.session.user.id,
        action: 'transfer.posted',
        entityType: 'transfer',
        entityId: row.transfer_id,
        ipAddress: ctx.clientIp,
        userAgent: ctx.userAgent,
        metadata: {
          fromCurrency: fromAcc.currency,
          toCurrency: toAcc.currency,
          fromAmount: balanced.fromAmount,
          toAmount: balanced.toAmount,
        },
      });
    }

    sendJson(res, row.is_duplicate ? 200 : 201, responsePayload);
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/transfers/:id/void — Atomic transfer reversal
  // --------------------------------------------------------------------------
  if (route.mode === 'void' && route.id && req.method === 'POST') {
    if (!z.string().uuid().safeParse(route.id).success) {
      throw new BadRequestError('Invalid transfer ID');
    }

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'transfers:void',
    });

    const { data: existing } = await ctx.supabase
      .from('transfers')
      .select('id, created_by, status')
      .eq('id', route.id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!existing) throw new NotFoundError('Transfer not found');

    if (existing.created_by !== ctx.session.user.id && !ADMIN_ROLES.includes(ctx.workspace.role)) {
      throw new ForbiddenError('Only the transfer creator or a workspace admin can void this transfer');
    }

    const { data: rpcRows, error: rpcErr } = await ctx.supabase.rpc('void_transfer_atomic', {
      p_workspace_id: ctx.workspace.id,
      p_transfer_id: route.id,
      p_actor_user_id: ctx.session.user.id,
    });

    if (rpcErr || !Array.isArray(rpcRows) || rpcRows.length === 0) {
      throw new BadRequestError(rpcErr?.message ?? 'Failed to void transfer');
    }

    const row = rpcRows[0] as {
      transfer_id: string;
      from_new_balance: string | number;
      to_new_balance: string | number;
    };

    await recordAuditLog(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.session.user.id,
      action: 'transfer.voided',
      entityType: 'transfer',
      entityId: route.id,
      ipAddress: ctx.clientIp,
      userAgent: ctx.userAgent,
    });

    sendJson(res, 200, {
      transferId: row.transfer_id,
      fromNewBalance: formatMoneyFixed4(row.from_new_balance),
      toNewBalance: formatMoneyFixed4(row.to_new_balance),
      status: 'voided',
    });
    return;
  }

  throw new NotFoundError('Transfer endpoint not found');
});
