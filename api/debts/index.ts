import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { parseJsonBody, sendJson, withApiHandler } from '../../server/http/response';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../server/security/errors';
import { recordAuditLog } from '../../server/security/audit';
import {
  ALL_ROLES,
  assertAccountAccessible,
  authenticateFinanceRequest,
  canUserAccessScopedRecord,
  WRITE_ROLES,
  type AccountAccessRecord,
} from '../../server/finance/access';
import {
  formatMoneyFixed4,
  normalizeCurrencyCode,
  parsePositiveMoney,
} from '../../server/finance/money';

const CreateDebtSchema = z.object({
  counterpartyName: z.string().trim().min(1).max(100),
  counterpartyContact: z.string().trim().max(120).optional().nullable(),
  direction: z.enum(['borrowed', 'lent']),
  principalAmount: z.union([z.string(), z.number()]),
  currency: z.string().trim().length(3),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(400).optional().nullable(),
  isPrivate: z.boolean().default(false),
});

const UpdateDebtSchema = z.object({
  counterpartyName: z.string().trim().min(1).max(100).optional(),
  counterpartyContact: z.string().trim().max(120).optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(400).optional().nullable(),
  isPrivate: z.boolean().optional(),
});

const RepayDebtSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.union([z.string(), z.number()]),
  notes: z.string().trim().max(300).optional().nullable(),
});

function resolveSub(req: VercelRequest): { id: string | null; action: string | null } {
  const qSub = typeof req.query.sub === 'string' ? req.query.sub.trim() : null;
  const qAction = typeof req.query.action === 'string' ? req.query.action.trim() : null;
  if (qSub) return { id: qSub, action: qAction };
  const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
  return { id: parts[2] ?? null, action: parts[3] ?? null };
}

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  const { id, action } = resolveSub(req);

  // GET /api/debts
  if (!id && req.method === 'GET') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'debts:list',
    });

    const { data, error } = await ctx.supabase
      .from('debts')
      .select(
        'id, counterparty_name, counterparty_contact, direction, principal_amount, remaining_amount, currency, issued_date, due_date, status, notes, is_private, created_by, created_at',
      )
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch debts: ${error.message}`);

    const todayIso = new Date().toISOString().slice(0, 10);
    const visible = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((d) => !d.is_private || d.created_by === ctx.session.user.id)
      .map((d) => {
        const principal = new Decimal(d.principal_amount as string | number);
        const remaining = new Decimal(d.remaining_amount as string | number);
        const paid = Decimal.max(0, principal.minus(remaining));
        const paidPct = principal.gt(0)
          ? paid.div(principal).times(100).toDecimalPlaces(1).toNumber()
          : 0;
        const isOverdue =
          d.status !== 'paid' &&
          d.status !== 'cancelled' &&
          Boolean(d.due_date && String(d.due_date) < todayIso);
        return {
          id: d.id,
          counterpartyName: d.counterparty_name,
          counterpartyContact: d.counterparty_contact,
          direction: d.direction,
          principalAmount: formatMoneyFixed4(principal),
          remainingAmount: formatMoneyFixed4(remaining),
          paidAmount: formatMoneyFixed4(paid),
          paidPct,
          currency: d.currency,
          issuedDate: d.issued_date,
          dueDate: d.due_date,
          status: isOverdue ? 'overdue' : d.status,
          notes: d.notes,
          isPrivate: Boolean(d.is_private),
        };
      });

    sendJson(res, 200, { debts: visible });
    return;
  }

  // POST /api/debts
  if (!id && req.method === 'POST') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'debts:create',
    });

    const parsed = CreateDebtSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid debt payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const principal = formatMoneyFixed4(parsePositiveMoney(parsed.data.principalAmount, 'principalAmount'));
    const currency = normalizeCurrencyCode(parsed.data.currency);

    const { data, error } = await ctx.supabase
      .from('debts')
      .insert({
        workspace_id: ctx.workspace.id,
        created_by: ctx.session.user.id,
        counterparty_name: parsed.data.counterpartyName,
        counterparty_contact: parsed.data.counterpartyContact ?? null,
        direction: parsed.data.direction,
        principal_amount: principal,
        remaining_amount: principal,
        currency,
        due_date: parsed.data.dueDate ?? null,
        notes: parsed.data.notes ?? null,
        is_private: parsed.data.isPrivate,
      })
      .select('id, counterparty_name, direction, principal_amount, remaining_amount, currency, status')
      .single();

    if (error || !data) throw new Error(`Failed to create debt: ${error?.message ?? 'unknown'}`);

    await recordAuditLog(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.session.user.id,
      action: 'debt.created',
      entityType: 'debt',
      entityId: data.id as string,
      ipAddress: ctx.clientIp,
      userAgent: ctx.userAgent,
    });

    sendJson(res, 201, { debt: data });
    return;
  }

  // PATCH /api/debts/:id — Edit debt metadata
  if (id && !action && req.method === 'PATCH') {
    if (!z.string().uuid().safeParse(id).success) throw new BadRequestError('Invalid debt ID');

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'debts:update',
    });

    const parsed = UpdateDebtSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid debt update payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const { data: existingDebt } = await ctx.supabase
      .from('debts')
      .select('id, is_private, created_by')
      .eq('id', id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!existingDebt) throw new NotFoundError('Debt not found');
    if (
      !canUserAccessScopedRecord({
        isPrivate: Boolean(existingDebt.is_private),
        createdBy: String(existingDebt.created_by),
        userId: ctx.session.user.id,
      })
    ) {
      throw new ForbiddenError('Cannot modify another member private debt');
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.counterpartyName !== undefined) {
      updates.counterparty_name = parsed.data.counterpartyName;
    }
    if (parsed.data.counterpartyContact !== undefined) {
      updates.counterparty_contact = parsed.data.counterpartyContact;
    }
    if (parsed.data.dueDate !== undefined) updates.due_date = parsed.data.dueDate;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
    if (parsed.data.isPrivate !== undefined) updates.is_private = parsed.data.isPrivate;

    if (Object.keys(updates).length === 0) {
      throw new BadRequestError('No fields provided to update');
    }

    const { data, error } = await ctx.supabase
      .from('debts')
      .update(updates)
      .eq('id', id)
      .eq('workspace_id', ctx.workspace.id)
      .select('id, counterparty_name, due_date, notes, is_private')
      .single();

    if (error || !data) throw new NotFoundError('Debt not found');
    sendJson(res, 200, { debt: data });
    return;
  }

  // GET /api/debts/:id/history — Payment history
  if (id && action === 'history' && req.method === 'GET') {
    if (!z.string().uuid().safeParse(id).success) throw new BadRequestError('Invalid debt ID');

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'debts:history',
    });

    const { data: debtMeta } = await ctx.supabase
      .from('debts')
      .select('id, is_private, created_by')
      .eq('id', id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!debtMeta) throw new NotFoundError('Debt not found');
    if (
      !canUserAccessScopedRecord({
        isPrivate: Boolean(debtMeta.is_private),
        createdBy: String(debtMeta.created_by),
        userId: ctx.session.user.id,
      })
    ) {
      throw new ForbiddenError('Access to private debt history is denied');
    }

    const { data, error } = await ctx.supabase
      .from('debt_payments')
      .select('id, amount, currency, paid_at, notes, account:accounts(id, name)')
      .eq('debt_id', id)
      .eq('workspace_id', ctx.workspace.id)
      .order('paid_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(`Failed to fetch debt payment history: ${error.message}`);

    const history = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const acc = (Array.isArray(row.account) ? row.account[0] : row.account) as {
        name?: string;
      } | null;
      return {
        id: row.id,
        amount: formatMoneyFixed4(row.amount as string | number),
        currency: row.currency,
        accountName: acc?.name ?? '',
        paidAt: row.paid_at,
        notes: row.notes,
      };
    });

    sendJson(res, 200, { history });
    return;
  }

  // POST /api/debts/:id/repay — Partial or full repayment posted atomically to ledger
  if (id && action === 'repay' && req.method === 'POST') {
    if (!z.string().uuid().safeParse(id).success) throw new BadRequestError('Invalid debt ID');

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'debts:repay',
    });

    const parsed = RepayDebtSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid repayment payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const amount = formatMoneyFixed4(parsePositiveMoney(parsed.data.amount, 'amount'));

    const [{ data: debt }, { data: account }] = await Promise.all([
      ctx.supabase
        .from('debts')
        .select('id, counterparty_name, direction, remaining_amount, currency, status, is_private, created_by')
        .eq('id', id)
        .eq('workspace_id', ctx.workspace.id)
        .maybeSingle(),
      ctx.supabase
        .from('accounts')
        .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, currency')
        .eq('id', parsed.data.accountId)
        .eq('workspace_id', ctx.workspace.id)
        .maybeSingle(),
    ]);

    if (!debt) throw new NotFoundError('Debt record not found');
    if (
      !canUserAccessScopedRecord({
        isPrivate: Boolean(debt.is_private),
        createdBy: String(debt.created_by),
        userId: ctx.session.user.id,
      })
    ) {
      throw new ForbiddenError('Cannot repay another member private debt');
    }
    if (!account) throw new NotFoundError('Account not found');
    assertAccountAccessible(
      account as AccountAccessRecord,
      ctx.session.user.id,
      ctx.workspace.id,
    );

    const remainingDec = new Decimal(debt.remaining_amount as string | number);
    const payDec = new Decimal(amount);
    if (payDec.gt(remainingDec)) {
      throw new ValidationError('Repayment exceeds remaining debt balance');
    }

    const nextRemaining = remainingDec.minus(payDec);
    const nextStatus = nextRemaining.isZero() ? 'paid' : 'partially_paid';

    const txType = debt.direction === 'borrowed' ? 'debt_repayment' : 'refund';

    const { data: txRows, error: txErr } = await ctx.supabase.rpc('post_transaction_atomic', {
      p_workspace_id: ctx.workspace.id,
      p_account_id: parsed.data.accountId,
      p_category_id: null,
      p_created_by: ctx.session.user.id,
      p_type: txType,
      p_amount: amount,
      p_reporting_currency: debt.currency,
      p_exchange_rate_used: 1,
      p_reporting_amount: amount,
      p_exchange_rate_id: null,
      p_occurred_at: new Date().toISOString(),
      p_description: `${debt.counterparty_name} (${debt.direction === 'borrowed' ? 'Debt repaid' : 'Loan collected'})`,
      p_notes: parsed.data.notes ?? null,
      p_tags: ['debt'],
      p_is_private: Boolean(debt.is_private),
      p_idempotency_key: ctx.idempotencyKey,
      p_adjustment_direction: 'credit',
    });

    if (txErr || !Array.isArray(txRows) || txRows.length === 0) {
      throw new BadRequestError(txErr?.message ?? 'Failed to post repayment transaction');
    }

    const txId = (txRows[0] as { transaction_id: string }).transaction_id;

    await Promise.all([
      ctx.supabase.from('debt_payments').insert({
        workspace_id: ctx.workspace.id,
        debt_id: id,
        account_id: parsed.data.accountId,
        transaction_id: txId,
        created_by: ctx.session.user.id,
        amount,
        currency: account.currency,
        notes: parsed.data.notes ?? null,
      }),
      ctx.supabase
        .from('debts')
        .update({
          remaining_amount: formatMoneyFixed4(nextRemaining),
          status: nextStatus,
        })
        .eq('id', id),
    ]);

    sendJson(res, 200, {
      debtId: id,
      transactionId: txId,
      remainingAmount: formatMoneyFixed4(nextRemaining),
      status: nextStatus,
    });
    return;
  }

  throw new NotFoundError('Debt endpoint not found');
});
