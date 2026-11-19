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
  ADMIN_ROLES,
  ALL_ROLES,
  authenticateFinanceRequest,
  canUserAccessAccount,
  canUserViewTransaction,
  WRITE_ROLES,
  type AccountAccessRecord,
} from '../../server/finance/access';
import {
  convertMoney,
  formatMoneyFixed4,
  normalizeCurrencyCode,
  parsePositiveMoney,
} from '../../server/finance/money';
import { fetchWorkspaceExchangeRates, resolveRateFromRows } from '../../server/finance/exchangeRates';
import { dispatchWorkspaceNotification } from '../../server/notifications/telegramBot';

const BudgetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  categoryId: z.string().uuid().optional().nullable(),
  periodType: z.enum(['weekly', 'monthly', 'custom']).default('monthly'),
  amountLimit: z.union([z.string(), z.number()]),
  currency: z.string().trim().length(3),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  isShared: z.boolean().default(true),
});

const UpdateBudgetSchema = BudgetSchema.partial();

function resolveWindow(periodType: string, startDateStr: string, endDateStr: string | null) {
  const now = new Date();
  if (periodType === 'weekly') {
    const day = now.getUTCDay() || 7;
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
    const to = new Date(from.getTime() + 7 * 86_400_000 - 1);
    return { from, to, key: from.toISOString().slice(0, 10) };
  }
  if (periodType === 'custom' && endDateStr) {
    return {
      from: new Date(`${startDateStr}T00:00:00.000Z`),
      to: new Date(`${endDateStr}T23:59:59.999Z`),
      key: `${startDateStr}:${endDateStr}`,
    };
  }
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { from, to, key: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}` };
}

function resolveBudgetId(req: VercelRequest): string | null {
  if (typeof req.query.sub === 'string' && req.query.sub.trim()) return req.query.sub.trim();
  const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
  return parts[2] ?? null;
}

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  const budgetId = resolveBudgetId(req);

  // GET /api/budgets — List budgets with real spent calculation & threshold alert checks
  if (!budgetId && req.method === 'GET') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'budgets:list',
    });

    const [{ data: rows, error }, { data: accountRows }, { data: txRows }, rateRows] = await Promise.all([
      ctx.supabase
        .from('budgets')
        .select(
          'id, workspace_id, category_id, created_by, name, period_type, amount_limit, currency, start_date, end_date, alert_thresholds, is_shared, is_active, created_at, category:categories(id, name, name_uz, name_ru, name_en, color)',
        )
        .eq('workspace_id', ctx.workspace.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false }),
      ctx.supabase
        .from('accounts')
        .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids')
        .eq('workspace_id', ctx.workspace.id),
      ctx.supabase
        .from('transactions')
        .select('id, workspace_id, account_id, category_id, created_by, is_private, amount, currency, occurred_at')
        .eq('workspace_id', ctx.workspace.id)
        .eq('type', 'expense')
        .eq('status', 'posted'),
      fetchWorkspaceExchangeRates(ctx.supabase, ctx.workspace.id),
    ]);

    if (error) throw new Error(`Failed to fetch budgets: ${error.message}`);

    const accessibleAccountMap = new Map(
      ((accountRows ?? []) as AccountAccessRecord[])
        .filter((a) => canUserAccessAccount(a, ctx.session.user.id, ctx.workspace.id))
        .map((a) => [a.id, a]),
    );

    const visibleBudgets = ((rows ?? []) as Array<Record<string, unknown>>).filter(
      (b) => Boolean(b.is_shared) || b.created_by === ctx.session.user.id,
    );

    const expenses = (
      (txRows ?? []) as Array<{
        id: string;
        workspace_id: string;
        account_id: string;
        category_id: string | null;
        created_by: string;
        is_private: boolean;
        amount: string | number;
        currency: string;
        occurred_at: string;
      }>
    ).filter((tx) => {
      const acc = accessibleAccountMap.get(tx.account_id);
      if (!acc) return false;
      return canUserViewTransaction(tx, acc, ctx.session.user.id, ctx.workspace.id);
    });

    const enriched = await Promise.all(
      visibleBudgets.map(async (b) => {
        const limitDec = new Decimal(b.amount_limit as string | number);
        const bCurr = String(b.currency);
        const win = resolveWindow(
          String(b.period_type),
          String(b.start_date),
          (b.end_date as string | null) ?? null,
        );

        const spentDec = expenses
          .filter((tx) => {
            const dt = new Date(tx.occurred_at);
            if (dt < win.from || dt > win.to) return false;
            if (b.category_id && tx.category_id !== b.category_id) return false;
            return true;
          })
          .reduce((acc, tx) => {
            if (tx.currency === bCurr) return acc.plus(tx.amount);
            const rate = resolveRateFromRows({
              rows: rateRows,
              baseCurrency: tx.currency,
              quoteCurrency: bCurr,
              workspaceId: ctx.workspace.id,
              asOfDate: new Date(tx.occurred_at),
            });
            return rate ? acc.plus(convertMoney(tx.amount, rate.rate)) : acc;
          }, new Decimal(0));

        const remainingDec = limitDec.minus(spentDec);
        const usagePct = limitDec.gt(0)
          ? spentDec.div(limitDec).times(100).toDecimalPlaces(1).toNumber()
          : 0;

        // Trigger deduplicated 50 / 75 / 90 / 100% budget alerts
        const thresholds = Array.isArray(b.alert_thresholds)
          ? (b.alert_thresholds as number[])
          : [50, 75, 90, 100];
        const crossed = thresholds.filter((th) => usagePct >= th);
        if (crossed.length > 0) {
          const highest = Math.max(...crossed);
          void dispatchWorkspaceNotification({
            supabase: ctx.supabase,
            workspaceId: ctx.workspace.id,
            userId: ctx.session.user.id,
            telegramId: ctx.session.user.telegramId,
            type: 'budget_warning',
            title: `${String(b.name)} (${highest}%)`,
            body: `${formatMoneyFixed4(spentDec)} / ${formatMoneyFixed4(limitDec)} ${bCurr}`,
            dedupeKey: `budget:${String(b.id)}:${win.key}:${highest}`,
          });
        }

        const cat = Array.isArray(b.category) ? b.category[0] : b.category;
        return {
          id: b.id,
          name: b.name,
          categoryId: b.category_id,
          category: cat ?? null,
          periodType: b.period_type,
          amountLimit: formatMoneyFixed4(limitDec),
          spentAmount: formatMoneyFixed4(spentDec),
          remainingAmount: formatMoneyFixed4(remainingDec),
          usagePct,
          currency: bCurr,
          startDate: b.start_date,
          endDate: b.end_date,
          isShared: Boolean(b.is_shared),
        };
      }),
    );

    sendJson(res, 200, { budgets: enriched });
    return;
  }

  // POST /api/budgets — Create budget
  if (!budgetId && req.method === 'POST') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'budgets:create',
    });

    const parsed = BudgetSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid budget payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const limit = formatMoneyFixed4(parsePositiveMoney(parsed.data.amountLimit, 'amountLimit'));
    const currency = normalizeCurrencyCode(parsed.data.currency);
    const startDate = parsed.data.startDate ?? new Date().toISOString().slice(0, 10);

    const { data, error } = await ctx.supabase
      .from('budgets')
      .insert({
        workspace_id: ctx.workspace.id,
        category_id: parsed.data.categoryId ?? null,
        created_by: ctx.session.user.id,
        name: parsed.data.name,
        period_type: parsed.data.periodType,
        amount_limit: limit,
        currency,
        start_date: startDate,
        end_date: parsed.data.endDate ?? null,
        is_shared: parsed.data.isShared,
      })
      .select('id, name, period_type, amount_limit, currency, start_date, end_date, is_shared')
      .single();

    if (error || !data) throw new Error(`Failed to create budget: ${error?.message ?? 'unknown'}`);

    await recordAuditLog(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.session.user.id,
      action: 'budget.created',
      entityType: 'budget',
      entityId: data.id as string,
      ipAddress: ctx.clientIp,
      userAgent: ctx.userAgent,
    });

    sendJson(res, 201, { budget: data });
    return;
  }

  // PATCH /api/budgets/:id — Edit budget
  if (budgetId && req.method === 'PATCH') {
    if (!z.string().uuid().safeParse(budgetId).success) throw new BadRequestError('Invalid budget ID');

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'budgets:update',
    });

    const parsed = UpdateBudgetSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid budget update payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const { data: existing } = await ctx.supabase
      .from('budgets')
      .select('id, created_by')
      .eq('id', budgetId)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!existing) throw new NotFoundError('Budget not found');
    if (existing.created_by !== ctx.session.user.id && !ADMIN_ROLES.includes(ctx.workspace.role)) {
      throw new ForbiddenError('Cannot edit another member budget');
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.categoryId !== undefined) updates.category_id = parsed.data.categoryId;
    if (parsed.data.periodType !== undefined) updates.period_type = parsed.data.periodType;
    if (parsed.data.amountLimit !== undefined) {
      updates.amount_limit = formatMoneyFixed4(
        parsePositiveMoney(parsed.data.amountLimit, 'amountLimit'),
      );
    }
    if (parsed.data.startDate !== undefined) updates.start_date = parsed.data.startDate;
    if (parsed.data.endDate !== undefined) updates.end_date = parsed.data.endDate;
    if (parsed.data.isShared !== undefined) updates.is_shared = parsed.data.isShared;

    const { data: updated, error } = await ctx.supabase
      .from('budgets')
      .update(updates)
      .eq('id', budgetId)
      .select('id, name, period_type, amount_limit, currency, start_date, end_date, is_shared')
      .single();

    if (error || !updated) throw new Error(`Failed to update budget: ${error?.message ?? 'unknown'}`);
    sendJson(res, 200, { budget: updated });
    return;
  }

  // DELETE /api/budgets/:id — Deactivate/archive budget
  if (budgetId && req.method === 'DELETE') {
    if (!z.string().uuid().safeParse(budgetId).success) throw new BadRequestError('Invalid budget ID');

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'budgets:delete',
    });

    const { data: existing } = await ctx.supabase
      .from('budgets')
      .select('id, created_by')
      .eq('id', budgetId)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!existing) throw new NotFoundError('Budget not found');
    if (existing.created_by !== ctx.session.user.id && !ADMIN_ROLES.includes(ctx.workspace.role)) {
      throw new ForbiddenError('Cannot delete another member budget');
    }

    await ctx.supabase.from('budgets').update({ is_active: false }).eq('id', budgetId);
    sendJson(res, 200, { deleted: true, id: budgetId });
    return;
  }

  throw new NotFoundError('Budget endpoint not found');
});
