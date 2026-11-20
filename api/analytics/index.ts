import type { VercelRequest, VercelResponse } from '@vercel/node';
import Decimal from 'decimal.js';
import { sendJson, withApiHandler } from '../../server/http/response.js';
import { BadRequestError } from '../../server/security/errors.js';
import {
  ALL_ROLES,
  authenticateFinanceRequest,
  canUserAccessAccount,
  canUserViewTransaction,
  type AccountAccessRecord,
} from '../../server/finance/access.js';
import {
  computeAnalyticsSnapshot,
  resolvePeriodRange,
  type AnalyticsPeriod,
  type AnalyticsTxInput,
} from '../../server/finance/analytics.js';
import { fetchWorkspaceExchangeRates, resolveRateFromRows } from '../../server/finance/exchangeRates.js';
import { convertMoney, formatMoneyFixed4, normalizeCurrencyCode } from '../../server/finance/money.js';
import { processDueRecurringRules } from '../../server/finance/recurring.js';

const VALID_PERIODS: AnalyticsPeriod[] = [
  'today',
  'week',
  'month',
  'last_month',
  'year',
  'custom',
];

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') {
    throw new BadRequestError('Use GET for /api/analytics');
  }

  const ctx = await authenticateFinanceRequest(req, {
    allowedRoles: ALL_ROLES,
    rateLimitKey: 'analytics:get',
  });

  // Lazy serverless recurring check (idempotent, never creates duplicates)
  await processDueRecurringRules({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    maxRules: 10,
  });

  const rawPeriod = typeof req.query.period === 'string' ? req.query.period.trim() : 'month';
  const period: AnalyticsPeriod = VALID_PERIODS.includes(rawPeriod as AnalyticsPeriod)
    ? (rawPeriod as AnalyticsPeriod)
    : 'month';
  const customFrom = typeof req.query.from === 'string' ? req.query.from : undefined;
  const customTo = typeof req.query.to === 'string' ? req.query.to : undefined;

  const range = resolvePeriodRange(period, customFrom, customTo);
  const reportingCurrency = normalizeCurrencyCode(
    typeof req.query.reportingCurrency === 'string' && req.query.reportingCurrency.trim().length === 3
      ? req.query.reportingCurrency
      : ctx.session.settings.reportingCurrency || ctx.workspace.defaultCurrency,
  );

  // Fetch up to 12 months of transactions for monthly trends + accounts, budgets, goals, recurring
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setUTCMonth(twelveMonthsAgo.getUTCMonth() - 11, 1);
  twelveMonthsAgo.setUTCHours(0, 0, 0, 0);
  const earliestNeeded =
    range.prevFrom < twelveMonthsAgo ? range.prevFrom.toISOString() : twelveMonthsAgo.toISOString();

  const [
    accountsRes,
    txRes,
    rateRows,
    budgetsRes,
    goalsRes,
    recurringRes,
    pendingExecRes,
  ] = await Promise.all([
    ctx.supabase
      .from('accounts')
      .select(
        'id, workspace_id, owner_user_id, name, type, currency, current_balance, visibility, allowed_member_ids, color, include_in_net_worth, is_archived',
      )
      .eq('workspace_id', ctx.workspace.id)
      .eq('is_archived', false),
    ctx.supabase
      .from('transactions')
      .select(
        'id, workspace_id, account_id, category_id, created_by, type, status, amount, currency, reporting_currency, reporting_amount, occurred_at, description, is_private, category:categories(id, name, name_uz, name_ru, name_en, color)',
      )
      .eq('workspace_id', ctx.workspace.id)
      .gte('occurred_at', earliestNeeded)
      .order('occurred_at', { ascending: false })
      .limit(1500),
    fetchWorkspaceExchangeRates(ctx.supabase, ctx.workspace.id),
    ctx.supabase
      .from('budgets')
      .select('id, name, category_id, period_type, amount_limit, currency, start_date, end_date, is_shared, created_by')
      .eq('workspace_id', ctx.workspace.id)
      .eq('is_active', true),
    ctx.supabase
      .from('savings_goals')
      .select('id, name, target_amount, current_amount, currency, deadline, status, color, is_shared, created_by')
      .eq('workspace_id', ctx.workspace.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(6),
    ctx.supabase
      .from('recurring_rules')
      .select('id, name, type, amount, currency, frequency, next_run_date, requires_confirmation')
      .eq('workspace_id', ctx.workspace.id)
      .eq('is_active', true)
      .order('next_run_date', { ascending: true })
      .limit(5),
    ctx.supabase
      .from('recurring_executions')
      .select('id')
      .eq('workspace_id', ctx.workspace.id)
      .eq('status', 'pending_confirmation'),
  ]);

  const accessibleAccounts = (
    (accountsRes.data ?? []) as Array<
      AccountAccessRecord & {
        name: string;
        type: string;
        currency: string;
        current_balance: string | number;
        color: string | null;
        include_in_net_worth: boolean;
      }
    >
  ).filter((a) => canUserAccessAccount(a, ctx.session.user.id, ctx.workspace.id));

  const accountMap = new Map(accessibleAccounts.map((a) => [a.id, a]));

  // Account distribution & consolidated balances
  let totalBalanceDec = new Decimal(0);
  let netWorthDec = new Decimal(0);
  let savingsAccountsTotalDec = new Decimal(0);

  const accountDistribution = accessibleAccounts.map((acc) => {
    const rate = resolveRateFromRows({
      rows: rateRows,
      baseCurrency: acc.currency,
      quoteCurrency: reportingCurrency,
      workspaceId: ctx.workspace.id,
    });
    const converted = rate
      ? convertMoney(formatMoneyFixed4(acc.current_balance), rate.rate)
      : '0.0000';
    totalBalanceDec = totalBalanceDec.plus(converted);
    if (acc.include_in_net_worth) {
      netWorthDec = netWorthDec.plus(converted);
    }
    if (acc.type === 'savings') {
      savingsAccountsTotalDec = savingsAccountsTotalDec.plus(converted);
    }
    return {
      accountId: acc.id,
      name: acc.name,
      currency: acc.currency,
      nativeBalance: formatMoneyFixed4(acc.current_balance),
      convertedBalance: Number(new Decimal(converted).toDecimalPlaces(2).toFixed(2)),
      color: acc.color || '#3B82F6',
    };
  });

  // Filter visible transactions
  const lang = ctx.session.settings.language;
  const visibleTxRows = ((txRes.data ?? []) as Array<Record<string, unknown>>).filter((row) => {
    const acc = accountMap.get(String(row.account_id));
    if (!acc) return false;
    return canUserViewTransaction(
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
  });

  const analyticsInputs: AnalyticsTxInput[] = visibleTxRows.map((row) => {
    const cat = (Array.isArray(row.category) ? row.category[0] : row.category) as {
      id: string;
      name: string;
      name_uz?: string;
      name_ru?: string;
      name_en?: string;
      color?: string;
    } | null;

    const localizedCatName = cat
      ? (lang === 'ru' && cat.name_ru) ||
        (lang === 'en' && cat.name_en) ||
        (lang === 'uz' && cat.name_uz) ||
        cat.name
      : lang === 'ru'
        ? 'Другое'
        : lang === 'en'
          ? 'Other'
          : 'Boshqa';

    return {
      id: String(row.id),
      accountId: String(row.account_id),
      categoryId: (row.category_id as string | null) ?? null,
      categoryName: localizedCatName,
      categoryColor: cat?.color || '#64748B',
      type: String(row.type),
      status: String(row.status),
      amount: formatMoneyFixed4(row.amount as string | number),
      currency: String(row.currency),
      reportingCurrency: (row.reporting_currency as string | null) ?? null,
      reportingAmount: row.reporting_amount
        ? formatMoneyFixed4(row.reporting_amount as string | number)
        : null,
      occurredAt: String(row.occurred_at),
    };
  });

  const snapshot = computeAnalyticsSnapshot({
    workspaceId: ctx.workspace.id,
    reportingCurrency,
    range,
    transactions: analyticsInputs,
    rateRows,
  });

  // Compute Budget Usage summary for visible budgets
  const visibleBudgets = ((budgetsRes.data ?? []) as Array<Record<string, unknown>>).filter(
    (b) => Boolean(b.is_shared) || b.created_by === ctx.session.user.id,
  );

  let totalBudgetLimit = new Decimal(0);
  let totalBudgetSpent = new Decimal(0);

  const budgetUsage = visibleBudgets.map((b) => {
    const limitDec = new Decimal(b.amount_limit as string | number);
    const bCurr = String(b.currency);
    const bCatId = b.category_id as string | null;

    const spentInBudgetCurr = analyticsInputs
      .filter((tx) => {
        if (tx.status !== 'posted' || tx.type !== 'expense') return false;
        const dt = new Date(tx.occurredAt);
        if (dt < range.from || dt > range.to) return false;
        if (bCatId && tx.categoryId !== bCatId) return false;
        return true;
      })
      .reduce((acc, tx) => {
        if (tx.currency === bCurr) return acc.plus(tx.amount);
        const rate = resolveRateFromRows({
          rows: rateRows,
          baseCurrency: tx.currency,
          quoteCurrency: bCurr,
          workspaceId: ctx.workspace.id,
          asOfDate: new Date(tx.occurredAt),
        });
        return rate ? acc.plus(convertMoney(tx.amount, rate.rate)) : acc;
      }, new Decimal(0));

    const toRepRate = resolveRateFromRows({
      rows: rateRows,
      baseCurrency: bCurr,
      quoteCurrency: reportingCurrency,
      workspaceId: ctx.workspace.id,
    });
    if (toRepRate) {
      totalBudgetLimit = totalBudgetLimit.plus(convertMoney(limitDec, toRepRate.rate));
      totalBudgetSpent = totalBudgetSpent.plus(convertMoney(spentInBudgetCurr, toRepRate.rate));
    }

    const usagePct = limitDec.gt(0)
      ? spentInBudgetCurr.div(limitDec).times(100).toDecimalPlaces(1).toNumber()
      : 0;

    return {
      id: b.id,
      name: b.name,
      currency: bCurr,
      limit: Number(limitDec.toDecimalPlaces(2).toFixed(2)),
      spent: Number(spentInBudgetCurr.toDecimalPlaces(2).toFixed(2)),
      usagePct,
    };
  });

  const overallBudgetUsagePct = totalBudgetLimit.gt(0)
    ? totalBudgetSpent.div(totalBudgetLimit).times(100).toDecimalPlaces(1).toNumber()
    : 0;

  // Savings goals summary
  const visibleGoals = ((goalsRes.data ?? []) as Array<Record<string, unknown>>)
    .filter((g) => Boolean(g.is_shared) || g.created_by === ctx.session.user.id)
    .map((g) => {
      const target = new Decimal(g.target_amount as string | number);
      const current = new Decimal(g.current_amount as string | number);
      return {
        id: g.id,
        name: g.name,
        targetAmount: formatMoneyFixed4(target),
        currentAmount: formatMoneyFixed4(current),
        currency: g.currency,
        deadline: g.deadline,
        color: g.color || '#10B981',
        progressPct: target.gt(0)
          ? Math.min(100, current.div(target).times(100).toDecimalPlaces(1).toNumber())
          : 0,
      };
    });

  // Net worth history derived from current net worth + reverse monthly net cash flows
  const monthlySeries = snapshot.charts.monthlyCashFlow;
  let runningNetWorth = netWorthDec;
  const netWorthHistory = [...monthlySeries]
    .reverse()
    .map((m) => {
      const point = {
        month: m.month,
        netWorth: Number(runningNetWorth.toDecimalPlaces(2).toFixed(2)),
      };
      runningNetWorth = runningNetWorth.minus(m.net);
      return point;
    })
    .reverse();

  const recentTransactions = visibleTxRows.slice(0, 6).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    accountName: accountMap.get(String(row.account_id))?.name ?? '',
    type: row.type,
    status: row.status,
    amount: formatMoneyFixed4(row.amount as string | number),
    currency: row.currency,
    description: row.description,
    occurredAt: row.occurred_at,
  }));

  sendJson(res, 200, {
    workspaceId: ctx.workspace.id,
    reportingCurrency,
    period: {
      type: period,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
    kpis: {
      totalBalance: formatMoneyFixed4(totalBalanceDec),
      netWorth: formatMoneyFixed4(netWorthDec),
      savingsTotal: formatMoneyFixed4(savingsAccountsTotalDec),
      budgetUsagePct: overallBudgetUsagePct,
      pendingRecurringCount: (pendingExecRes.data ?? []).length,
      ...snapshot.metrics,
    },
    charts: {
      ...snapshot.charts,
      accountDistribution,
      budgetUsage,
      netWorthHistory,
    },
    recentTransactions,
    upcomingPayments: recurringRes.data ?? [],
    activeGoals: visibleGoals,
  });
});
