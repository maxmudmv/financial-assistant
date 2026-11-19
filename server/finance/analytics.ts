import Decimal from 'decimal.js';
import { convertMoney, formatMoneyFixed4, parseMoney } from './money';
import { resolveRateFromRows, type ExchangeRateRow } from './exchangeRates';

export type AnalyticsPeriod = 'today' | 'week' | 'month' | 'last_month' | 'year' | 'custom';

export interface PeriodRange {
  period: AnalyticsPeriod;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
}

export function resolvePeriodRange(
  period: AnalyticsPeriod,
  customFrom?: string,
  customTo?: string,
  now = new Date(),
): PeriodRange {
  const endOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999),
  );
  let from: Date;
  let to: Date = endOfToday;

  switch (period) {
    case 'today': {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      break;
    }
    case 'week': {
      const day = now.getUTCDay() || 7;
      from = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1), 0, 0, 0, 0),
      );
      break;
    }
    case 'last_month': {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
      to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
      break;
    }
    case 'year': {
      from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      break;
    }
    case 'custom': {
      const parsedFrom = customFrom ? new Date(customFrom) : null;
      const parsedTo = customTo ? new Date(customTo) : null;
      from =
        parsedFrom && !Number.isNaN(parsedFrom.getTime())
          ? parsedFrom
          : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      to = parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : endOfToday;
      if (from > to) {
        const tmp = from;
        from = to;
        to = tmp;
      }
      break;
    }
    case 'month':
    default: {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      break;
    }
  }

  const durationMs = Math.max(86_400_000, to.getTime() - from.getTime());
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs);

  return { period, from, to, prevFrom, prevTo };
}

export interface AnalyticsTxInput {
  id: string;
  accountId: string;
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  type: string;
  status: string;
  amount: string;
  currency: string;
  reportingCurrency: string | null;
  reportingAmount: string | null;
  occurredAt: string;
  createdBy?: string;
}

export function resolveTxReportingAmount(
  tx: Pick<
    AnalyticsTxInput,
    'amount' | 'currency' | 'reportingCurrency' | 'reportingAmount' | 'occurredAt'
  >,
  targetCurrency: string,
  rateRows: ExchangeRateRow[],
  workspaceId: string,
): Decimal {
  if (tx.currency === targetCurrency) {
    return parseMoney(tx.amount);
  }
  if (tx.reportingCurrency === targetCurrency && tx.reportingAmount !== null) {
    return parseMoney(tx.reportingAmount);
  }
  const resolved = resolveRateFromRows({
    rows: rateRows,
    baseCurrency: tx.currency,
    quoteCurrency: targetCurrency,
    workspaceId,
    asOfDate: new Date(tx.occurredAt),
  });
  if (!resolved) {
    return new Decimal(0);
  }
  return parseMoney(convertMoney(tx.amount, resolved.rate));
}

export function computeAnalyticsSnapshot(params: {
  workspaceId: string;
  reportingCurrency: string;
  range: PeriodRange;
  transactions: AnalyticsTxInput[];
  rateRows: ExchangeRateRow[];
}) {
  const { workspaceId, reportingCurrency, range, transactions, rateRows } = params;

  let incomeDec = new Decimal(0);
  let expenseDec = new Decimal(0);
  let prevIncomeDec = new Decimal(0);
  let prevExpenseDec = new Decimal(0);
  let savingsNetDec = new Decimal(0);

  const dailyMap = new Map<string, { date: string; income: Decimal; expense: Decimal }>();
  const monthlyMap = new Map<
    string,
    { month: string; income: Decimal; expense: Decimal; savingsDelta: Decimal }
  >();
  const categoryMap = new Map<
    string,
    {
      categoryId: string;
      name: string;
      color: string;
      amount: Decimal;
      prevAmount: Decimal;
      txCount: number;
    }
  >();

  for (const tx of transactions) {
    if (tx.status !== 'posted' || tx.type === 'transfer') continue;

    const dt = new Date(tx.occurredAt);
    const val = resolveTxReportingAmount(tx, reportingCurrency, rateRows, workspaceId);

    const monthKey = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    const mEntry = monthlyMap.get(monthKey) ?? {
      month: monthKey,
      income: new Decimal(0),
      expense: new Decimal(0),
      savingsDelta: new Decimal(0),
    };
    if (tx.type === 'income' || tx.type === 'refund') {
      mEntry.income = mEntry.income.plus(val);
    } else if (tx.type === 'expense') {
      mEntry.expense = mEntry.expense.plus(val);
    } else if (tx.type === 'savings_contribution') {
      mEntry.savingsDelta = mEntry.savingsDelta.plus(val);
    } else if (tx.type === 'savings_withdrawal') {
      mEntry.savingsDelta = mEntry.savingsDelta.minus(val);
    }
    monthlyMap.set(monthKey, mEntry);

    const catKey = tx.categoryId ?? 'uncategorized';

    // Previous period comparison
    if (dt >= range.prevFrom && dt <= range.prevTo) {
      if (tx.type === 'income' || tx.type === 'refund') {
        prevIncomeDec = prevIncomeDec.plus(val);
      } else if (tx.type === 'expense') {
        prevExpenseDec = prevExpenseDec.plus(val);
        const existingCat = categoryMap.get(catKey) ?? {
          categoryId: catKey,
          name: tx.categoryName,
          color: tx.categoryColor,
          amount: new Decimal(0),
          prevAmount: new Decimal(0),
          txCount: 0,
        };
        existingCat.prevAmount = existingCat.prevAmount.plus(val);
        categoryMap.set(catKey, existingCat);
      }
    }

    // Selected period metrics
    if (dt < range.from || dt > range.to) continue;

    const dayKey = tx.occurredAt.slice(0, 10);
    const dEntry = dailyMap.get(dayKey) ?? {
      date: dayKey,
      income: new Decimal(0),
      expense: new Decimal(0),
    };

    if (tx.type === 'income' || tx.type === 'refund') {
      incomeDec = incomeDec.plus(val);
      dEntry.income = dEntry.income.plus(val);
    } else if (tx.type === 'expense') {
      expenseDec = expenseDec.plus(val);
      dEntry.expense = dEntry.expense.plus(val);

      const existingCat = categoryMap.get(catKey) ?? {
        categoryId: catKey,
        name: tx.categoryName,
        color: tx.categoryColor,
        amount: new Decimal(0),
        prevAmount: new Decimal(0),
        txCount: 0,
      };
      existingCat.amount = existingCat.amount.plus(val);
      existingCat.txCount += 1;
      categoryMap.set(catKey, existingCat);
    } else if (tx.type === 'savings_contribution') {
      savingsNetDec = savingsNetDec.plus(val);
    } else if (tx.type === 'savings_withdrawal') {
      savingsNetDec = savingsNetDec.minus(val);
    }

    dailyMap.set(dayKey, dEntry);
  }

  const netCashFlowDec = incomeDec.minus(expenseDec);
  const savingsRate = incomeDec.gt(0)
    ? netCashFlowDec.div(incomeDec).times(100).toDecimalPlaces(1).toNumber()
    : 0;

  const daysInPeriod = Math.max(
    1,
    Math.ceil((range.to.getTime() - range.from.getTime()) / 86_400_000),
  );
  const avgDailyExpenseDec = expenseDec.div(daysInPeriod);

  const monthlyGrowthPct = prevExpenseDec.gt(0)
    ? expenseDec.minus(prevExpenseDec).div(prevExpenseDec).times(100).toDecimalPlaces(1).toNumber()
    : 0;

  const categoryBreakdown = Array.from(categoryMap.values())
    .filter((c) => c.amount.gt(0))
    .sort((a, b) => b.amount.comparedTo(a.amount))
    .map((c) => ({
      categoryId: c.categoryId,
      name: c.name,
      color: c.color,
      txCount: c.txCount,
      amount: Number(c.amount.toDecimalPlaces(2).toFixed(2)),
      amountFormatted: formatMoneyFixed4(c.amount),
      sharePct: expenseDec.gt(0)
        ? c.amount.div(expenseDec).times(100).toDecimalPlaces(1).toNumber()
        : 0,
    }));

  const monthlyComparisons = Array.from(categoryMap.values())
    .filter((c) => c.amount.gt(0) || c.prevAmount.gt(0))
    .sort((a, b) => b.amount.plus(b.prevAmount).comparedTo(a.amount.plus(a.prevAmount)))
    .slice(0, 8)
    .map((c) => ({
      categoryId: c.categoryId,
      name: c.name,
      color: c.color,
      currentExpense: Number(c.amount.toDecimalPlaces(2).toFixed(2)),
      previousExpense: Number(c.prevAmount.toDecimalPlaces(2).toFixed(2)),
      changePct: c.prevAmount.gt(0)
        ? c.amount.minus(c.prevAmount).div(c.prevAmount).times(100).toDecimalPlaces(1).toNumber()
        : 0,
    }));

  const highestSpendingCategory = categoryBreakdown[0] ?? null;

  const dailySpending = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      income: Number(d.income.toDecimalPlaces(2).toFixed(2)),
      expense: Number(d.expense.toDecimalPlaces(2).toFixed(2)),
    }));

  const sortedMonths = Array.from(monthlyMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);

  const monthlyCashFlow = sortedMonths.map((m) => ({
    month: m.month,
    income: Number(m.income.toDecimalPlaces(2).toFixed(2)),
    expense: Number(m.expense.toDecimalPlaces(2).toFixed(2)),
    net: Number(m.income.minus(m.expense).toDecimalPlaces(2).toFixed(2)),
  }));

  let cumulativeSavings = new Decimal(0);
  const savingsGrowth = sortedMonths.map((m) => {
    const netMonthSavings = m.savingsDelta.gt(0)
      ? m.savingsDelta
      : Decimal.max(0, m.income.minus(m.expense));
    cumulativeSavings = cumulativeSavings.plus(netMonthSavings);
    return {
      month: m.month,
      monthlySaved: Number(netMonthSavings.toDecimalPlaces(2).toFixed(2)),
      cumulativeSavings: Number(cumulativeSavings.toDecimalPlaces(2).toFixed(2)),
    };
  });

  const incomeVsExpenses = [
    {
      label: 'Previous',
      income: Number(prevIncomeDec.toDecimalPlaces(2).toFixed(2)),
      expense: Number(prevExpenseDec.toDecimalPlaces(2).toFixed(2)),
    },
    {
      label: 'Current',
      income: Number(incomeDec.toDecimalPlaces(2).toFixed(2)),
      expense: Number(expenseDec.toDecimalPlaces(2).toFixed(2)),
    },
  ];

  return {
    metrics: {
      totalIncome: formatMoneyFixed4(incomeDec),
      totalExpenses: formatMoneyFixed4(expenseDec),
      netCashFlow: formatMoneyFixed4(netCashFlowDec),
      savingsContributionNet: formatMoneyFixed4(savingsNetDec),
      savingsRate,
      averageDailyExpenses: formatMoneyFixed4(avgDailyExpenseDec),
      monthlyGrowthPct,
      highestSpendingCategory,
    },
    charts: {
      incomeVsExpenses,
      dailySpending,
      monthlyCashFlow,
      categoryBreakdown,
      monthlyComparisons,
      savingsGrowth,
    },
  };
}
