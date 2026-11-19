import type { VercelRequest, VercelResponse } from '@vercel/node';
import Decimal from 'decimal.js';
import { sendJson, withApiHandler } from '../../server/http/response';
import { BadRequestError } from '../../server/security/errors';
import {
  ALL_ROLES,
  authenticateFinanceRequest,
  canUserAccessAccount,
  canUserViewTransaction,
  type AccountAccessRecord,
} from '../../server/finance/access';
import {
  computeAnalyticsSnapshot,
  resolvePeriodRange,
  resolveTxReportingAmount,
  type AnalyticsPeriod,
  type AnalyticsTxInput,
} from '../../server/finance/analytics';
import { fetchWorkspaceExchangeRates, resolveRateFromRows } from '../../server/finance/exchangeRates';
import { convertMoney, formatMoneyFixed4, normalizeCurrencyCode } from '../../server/finance/money';
import {
  generateCsvReport,
  generatePdfReport,
  generateXlsxReport,
  type TabularReportPayload,
} from '../../server/reports/exporters';

export type ReportType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'category'
  | 'account'
  | 'family';

const VALID_REPORT_TYPES: ReportType[] = [
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'category',
  'account',
  'family',
];

function resolveRoute(req: VercelRequest): {
  domain: 'reports' | 'notifications';
  sub: string;
} {
  const domain = req.query.domain === 'notifications' ? 'notifications' : 'reports';
  const qSub = typeof req.query.sub === 'string' ? req.query.sub.trim() : '';
  if (qSub) return { domain, sub: qSub };

  const pathname = (req.url ?? '').split('?')[0];
  const parts = pathname.split('/').filter(Boolean);
  if (parts[1] === 'notifications') {
    return { domain: 'notifications', sub: parts[2] ?? 'list' };
  }
  return { domain: 'reports', sub: parts[2] ?? 'summary' };
}

function getIsoWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  const route = resolveRoute(req);

  // --------------------------------------------------------------------------
  // Notifications Domain (/api/notifications & /api/notifications/read)
  // --------------------------------------------------------------------------
  if (route.domain === 'notifications') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'notifications',
    });

    if (route.sub === 'read' && req.method === 'POST') {
      await ctx.supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString(), delivery_status: 'read' })
        .eq('user_id', ctx.session.user.id)
        .is('read_at', null);

      sendJson(res, 200, { markedRead: true });
      return;
    }

    if (req.method === 'GET') {
      const { data, error } = await ctx.supabase
        .from('notifications')
        .select('id, type, title, body, channel, delivery_status, read_at, created_at')
        .eq('user_id', ctx.session.user.id)
        .order('created_at', { ascending: false })
        .limit(40);

      if (error) throw new Error(`Failed to fetch notifications: ${error.message}`);

      const items = data ?? [];
      const unreadCount = items.filter((n) => !n.read_at).length;

      sendJson(res, 200, {
        unreadCount,
        notifications: items,
      });
      return;
    }

    throw new BadRequestError('Method not allowed');
  }

  // --------------------------------------------------------------------------
  // Reports Domain (/api/reports & /api/reports/export)
  // --------------------------------------------------------------------------
  const ctx = await authenticateFinanceRequest(req, {
    allowedRoles: ALL_ROLES,
    rateLimitKey: 'reports:get',
  });

  if (req.method !== 'GET') {
    throw new BadRequestError('Use GET for /api/reports');
  }

  const rawReportType =
    typeof req.query.reportType === 'string' ? req.query.reportType.trim() : 'monthly';
  const reportType: ReportType = VALID_REPORT_TYPES.includes(rawReportType as ReportType)
    ? (rawReportType as ReportType)
    : 'monthly';

  const rawPeriod = typeof req.query.period === 'string' ? req.query.period.trim() : 'year';
  const period: AnalyticsPeriod = (
    ['today', 'week', 'month', 'last_month', 'year', 'custom'] as const
  ).includes(rawPeriod as AnalyticsPeriod)
    ? (rawPeriod as AnalyticsPeriod)
    : 'year';

  const range = resolvePeriodRange(
    period,
    typeof req.query.from === 'string' ? req.query.from : undefined,
    typeof req.query.to === 'string' ? req.query.to : undefined,
  );
  const reportingCurrency = normalizeCurrencyCode(
    ctx.session.settings.reportingCurrency || ctx.workspace.defaultCurrency,
  );

  const [accountsRes, txRes, membersRes, rateRows] = await Promise.all([
    ctx.supabase
      .from('accounts')
      .select(
        'id, workspace_id, owner_user_id, name, type, currency, opening_balance, current_balance, visibility, allowed_member_ids',
      )
      .eq('workspace_id', ctx.workspace.id),
    ctx.supabase
      .from('transactions')
      .select(
        'id, workspace_id, account_id, category_id, created_by, type, status, amount, currency, reporting_currency, reporting_amount, occurred_at, description, notes, is_private, category:categories(id, name, name_uz, name_ru, name_en, color)',
      )
      .eq('workspace_id', ctx.workspace.id)
      .gte('occurred_at', range.from.toISOString())
      .lte('occurred_at', range.to.toISOString())
      .order('occurred_at', { ascending: false })
      .limit(1500),
    ctx.supabase
      .from('workspace_members')
      .select('role, user:users!inner(id, username, first_name, last_name)')
      .eq('workspace_id', ctx.workspace.id),
    fetchWorkspaceExchangeRates(ctx.supabase, ctx.workspace.id),
  ]);

  const accessibleAccounts = new Map(
    (
      (accountsRes.data ?? []) as Array<
        AccountAccessRecord & {
          name: string;
          type: string;
          currency: string;
          opening_balance: string | number;
          current_balance: string | number;
        }
      >
    )
      .filter((a) => canUserAccessAccount(a, ctx.session.user.id, ctx.workspace.id))
      .map((a) => [a.id, a]),
  );

  const memberNameMap = new Map<string, { name: string; role: string }>();
  for (const m of (membersRes.data ?? []) as Array<Record<string, unknown>>) {
    const u = (Array.isArray(m.user) ? m.user[0] : m.user) as Record<string, unknown>;
    if (u?.id) {
      const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || String(u.username ?? 'Member');
      memberNameMap.set(String(u.id), { name: fullName, role: String(m.role) });
    }
  }

  const lang = ctx.session.settings.language;
  const visibleRows = ((txRes.data ?? []) as Array<Record<string, unknown>>).filter((row) => {
    const acc = accessibleAccounts.get(String(row.account_id));
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

  const inputs: AnalyticsTxInput[] = visibleRows.map((row) => {
    const cat = (Array.isArray(row.category) ? row.category[0] : row.category) as {
      id: string;
      name: string;
      name_uz?: string;
      name_ru?: string;
      name_en?: string;
      color?: string;
    } | null;
    const catName = cat
      ? (lang === 'ru' && cat.name_ru) ||
        (lang === 'en' && cat.name_en) ||
        (lang === 'uz' && cat.name_uz) ||
        cat.name
      : 'Other';
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      categoryId: (row.category_id as string | null) ?? null,
      categoryName: catName,
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
      createdBy: String(row.created_by),
    };
  });

  const snapshot = computeAnalyticsSnapshot({
    workspaceId: ctx.workspace.id,
    reportingCurrency,
    range,
    transactions: inputs,
    rateRows,
  });

  // Build All 7 Report Breakdowns from actual database rows
  // 1–4: Time bucket breakdowns (daily, weekly, monthly, yearly)
  const buildTimeBreakdown = (bucketFn: (iso: string) => string) => {
    const map = new Map<
      string,
      { bucket: string; income: Decimal; expense: Decimal; count: number }
    >();
    for (const tx of inputs) {
      if (tx.status !== 'posted' || tx.type === 'transfer') continue;
      const key = bucketFn(tx.occurredAt);
      const val = resolveTxReportingAmount(tx, reportingCurrency, rateRows, ctx.workspace.id);
      const entry = map.get(key) ?? {
        bucket: key,
        income: new Decimal(0),
        expense: new Decimal(0),
        count: 0,
      };
      if (tx.type === 'income' || tx.type === 'refund') {
        entry.income = entry.income.plus(val);
      } else if (tx.type === 'expense') {
        entry.expense = entry.expense.plus(val);
      }
      entry.count += 1;
      map.set(key, entry);
    }
    return Array.from(map.values())
      .sort((a, b) => b.bucket.localeCompare(a.bucket))
      .map((item) => ({
        periodKey: item.bucket,
        income: formatMoneyFixed4(item.income),
        expense: formatMoneyFixed4(item.expense),
        netCashFlow: formatMoneyFixed4(item.income.minus(item.expense)),
        txCount: item.count,
      }));
  };

  const dailyBreakdown = buildTimeBreakdown((iso) => iso.slice(0, 10));
  const weeklyBreakdown = buildTimeBreakdown((iso) => getIsoWeekKey(iso));
  const monthlyBreakdown = buildTimeBreakdown((iso) => iso.slice(0, 7));
  const yearlyBreakdown = buildTimeBreakdown((iso) => iso.slice(0, 4));

  // 5: Account Report
  const accountReport = Array.from(accessibleAccounts.values()).map((acc) => {
    let totalIn = new Decimal(0);
    let totalOut = new Decimal(0);
    let txCount = 0;
    for (const tx of inputs) {
      if (tx.accountId !== acc.id || tx.status !== 'posted') continue;
      txCount += 1;
      if (tx.type === 'income' || tx.type === 'refund' || tx.type === 'savings_withdrawal') {
        totalIn = totalIn.plus(tx.amount);
      } else if (tx.type === 'expense' || tx.type === 'savings_contribution' || tx.type === 'debt_repayment') {
        totalOut = totalOut.plus(tx.amount);
      }
    }
    const rate = resolveRateFromRows({
      rows: rateRows,
      baseCurrency: acc.currency,
      quoteCurrency: reportingCurrency,
      workspaceId: ctx.workspace.id,
    });
    const convertedClosing = rate
      ? convertMoney(formatMoneyFixed4(acc.current_balance), rate.rate)
      : formatMoneyFixed4(acc.current_balance);

    return {
      accountId: acc.id,
      name: acc.name,
      type: acc.type,
      currency: acc.currency,
      openingBalance: formatMoneyFixed4(acc.opening_balance),
      totalInflow: formatMoneyFixed4(totalIn),
      totalOutflow: formatMoneyFixed4(totalOut),
      closingBalance: formatMoneyFixed4(acc.current_balance),
      convertedClosingBalance: convertedClosing,
      txCount,
    };
  });

  // 6: Family / Member Report
  const familyMap = new Map<
    string,
    { userId: string; memberName: string; role: string; income: Decimal; expense: Decimal; txCount: number }
  >();
  for (const [userId, info] of memberNameMap.entries()) {
    familyMap.set(userId, {
      userId,
      memberName: info.name,
      role: info.role,
      income: new Decimal(0),
      expense: new Decimal(0),
      txCount: 0,
    });
  }
  for (const tx of inputs) {
    if (tx.status !== 'posted' || tx.type === 'transfer' || !tx.createdBy) continue;
    const val = resolveTxReportingAmount(tx, reportingCurrency, rateRows, ctx.workspace.id);
    const info = memberNameMap.get(tx.createdBy) ?? { name: 'Member', role: 'member' };
    const entry = familyMap.get(tx.createdBy) ?? {
      userId: tx.createdBy,
      memberName: info.name,
      role: info.role,
      income: new Decimal(0),
      expense: new Decimal(0),
      txCount: 0,
    };
    if (tx.type === 'income' || tx.type === 'refund') {
      entry.income = entry.income.plus(val);
    } else if (tx.type === 'expense') {
      entry.expense = entry.expense.plus(val);
    }
    entry.txCount += 1;
    familyMap.set(tx.createdBy, entry);
  }
  const familyReport = Array.from(familyMap.values()).map((f) => ({
    userId: f.userId,
    memberName: f.memberName,
    role: f.role,
    income: formatMoneyFixed4(f.income),
    expense: formatMoneyFixed4(f.expense),
    netContribution: formatMoneyFixed4(f.income.minus(f.expense)),
    txCount: f.txCount,
  }));

  // --------------------------------------------------------------------------
  // On-Demand Export Endpoint: GET /api/reports/export?reportType=...&format=csv|xlsx|pdf
  // --------------------------------------------------------------------------
  if (route.sub === 'export') {
    const rawFormat = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'csv';
    const format = rawFormat === 'xlsx' || rawFormat === 'xls' ? 'xlsx' : rawFormat === 'pdf' ? 'pdf' : 'csv';

    let headers: string[];
    let rows: Array<Array<string | number>>;

    if (reportType === 'category') {
      headers = ['Category', 'Transactions', 'Total Expense', 'Currency', 'Share %'];
      rows = snapshot.charts.categoryBreakdown.map((c) => [
        c.name,
        c.txCount ?? 0,
        c.amountFormatted,
        reportingCurrency,
        `${c.sharePct}%`,
      ]);
    } else if (reportType === 'account') {
      headers = ['Account', 'Type', 'Currency', 'Opening', 'Inflow', 'Outflow', 'Closing', `In ${reportingCurrency}`];
      rows = accountReport.map((a) => [
        a.name,
        a.type,
        a.currency,
        a.openingBalance,
        a.totalInflow,
        a.totalOutflow,
        a.closingBalance,
        a.convertedClosingBalance,
      ]);
    } else if (reportType === 'family') {
      headers = ['Member', 'Role', 'Transactions', 'Income', 'Expense', 'Net Contribution', 'Currency'];
      rows = familyReport.map((f) => [
        f.memberName,
        f.role,
        f.txCount,
        f.income,
        f.expense,
        f.netContribution,
        reportingCurrency,
      ]);
    } else {
      const series =
        reportType === 'daily'
          ? dailyBreakdown
          : reportType === 'weekly'
            ? weeklyBreakdown
            : reportType === 'yearly'
              ? yearlyBreakdown
              : monthlyBreakdown;
      headers = ['Period', 'Transactions', 'Income', 'Expense', 'Net Cash Flow', 'Currency'];
      rows = series.map((s) => [
        s.periodKey,
        s.txCount,
        s.income,
        s.expense,
        s.netCashFlow,
        reportingCurrency,
      ]);
    }

    const tabularPayload: TabularReportPayload = {
      title: `FINORA — ${ctx.workspace.name} (${reportType.toUpperCase()} REPORT)`,
      subtitle: `Period: ${range.from.toISOString().slice(0, 10)} to ${range.to.toISOString().slice(0, 10)} | Reporting Currency: ${reportingCurrency}`,
      summary: [
        { label: 'Total Income', value: `${snapshot.metrics.totalIncome} ${reportingCurrency}` },
        { label: 'Total Expenses', value: `${snapshot.metrics.totalExpenses} ${reportingCurrency}` },
        { label: 'Net Cash Flow', value: `${snapshot.metrics.netCashFlow} ${reportingCurrency}` },
        { label: 'Savings Rate', value: `${snapshot.metrics.savingsRate}%` },
        { label: 'Transactions Count', value: String(visibleRows.length) },
      ],
      headers,
      rows,
    };

    if (format === 'pdf') {
      const pdfBuf = generatePdfReport(tabularPayload);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="finora-${reportType}-${period}.pdf"`,
      );
      res.status(200).send(pdfBuf);
      return;
    }

    if (format === 'xlsx') {
      const xlsxBuf = generateXlsxReport(tabularPayload);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="finora-${reportType}-${period}.xlsx"`,
      );
      res.status(200).send(xlsxBuf);
      return;
    }

    const csvBuf = generateCsvReport(tabularPayload);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="finora-${reportType}-${period}.csv"`,
    );
    res.status(200).send(csvBuf);
    return;
  }

  sendJson(res, 200, {
    workspaceName: ctx.workspace.name,
    workspaceType: ctx.workspace.type,
    reportingCurrency,
    reportType,
    period,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    transactionCount: visibleRows.length,
    ...snapshot,
    reports: {
      daily: dailyBreakdown,
      weekly: weeklyBreakdown,
      monthly: monthlyBreakdown,
      yearly: yearlyBreakdown,
      category: snapshot.charts.categoryBreakdown,
      account: accountReport,
      family: familyReport,
    },
  });
});
