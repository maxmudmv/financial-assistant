import { describe, expect, it } from 'vitest';
import {
  computeAnalyticsSnapshot,
  resolvePeriodRange,
} from '../../server/finance/analytics';
import { computeNextRunDate } from '../../server/finance/recurring';
import type { ExchangeRateRow } from '../../server/finance/exchangeRates';

const SAMPLE_RATES: ExchangeRateRow[] = [
  {
    id: 'r1',
    workspace_id: null,
    base_currency: 'USD',
    quote_currency: 'UZS',
    rate: '12800.00000000',
    source: 'manual_seed',
    is_manual: false,
    effective_at: '2026-11-01T00:00:00.000Z',
    fetched_at: '2026-11-01T00:00:00.000Z',
  },
];

describe('Analytics snapshot & serverless recurring date math', () => {
  it('computes income, expenses, savings rate, and excludes internal transfers & voided txs', () => {
    const range = resolvePeriodRange('month', undefined, undefined, new Date('2026-11-19T12:00:00Z'));

    const snapshot = computeAnalyticsSnapshot({
      workspaceId: 'ws-1',
      reportingCurrency: 'UZS',
      range,
      rateRows: SAMPLE_RATES,
      transactions: [
        {
          id: 't1',
          accountId: 'a1',
          categoryId: 'c1',
          categoryName: 'Salary',
          categoryColor: '#10B981',
          type: 'income',
          status: 'posted',
          amount: '1000.0000',
          currency: 'USD',
          reportingCurrency: 'UZS',
          reportingAmount: '12800000.0000',
          occurredAt: '2026-11-05T10:00:00.000Z',
        },
        {
          id: 't2',
          accountId: 'a1',
          categoryId: 'c2',
          categoryName: 'Groceries',
          categoryColor: '#F59E0B',
          type: 'expense',
          status: 'posted',
          amount: '3200000.0000',
          currency: 'UZS',
          reportingCurrency: 'UZS',
          reportingAmount: '3200000.0000',
          occurredAt: '2026-11-10T10:00:00.000Z',
        },
        {
          id: 't3',
          accountId: 'a1',
          categoryId: null,
          categoryName: 'Transfer',
          categoryColor: '#64748B',
          type: 'transfer',
          status: 'posted',
          amount: '5000000.0000',
          currency: 'UZS',
          reportingCurrency: 'UZS',
          reportingAmount: '5000000.0000',
          occurredAt: '2026-11-12T10:00:00.000Z',
        },
        {
          id: 't4',
          accountId: 'a1',
          categoryId: 'c2',
          categoryName: 'Groceries',
          categoryColor: '#F59E0B',
          type: 'expense',
          status: 'voided',
          amount: '999999.0000',
          currency: 'UZS',
          reportingCurrency: 'UZS',
          reportingAmount: '999999.0000',
          occurredAt: '2026-11-14T10:00:00.000Z',
        },
      ],
    });

    expect(snapshot.metrics.totalIncome).toBe('12800000.0000');
    expect(snapshot.metrics.totalExpenses).toBe('3200000.0000');
    expect(snapshot.metrics.netCashFlow).toBe('9600000.0000');
    expect(snapshot.metrics.savingsRate).toBe(75);
    expect(snapshot.metrics.highestSpendingCategory?.name).toBe('Groceries');
    expect(snapshot.charts.categoryBreakdown).toHaveLength(1);
    expect(snapshot.charts.incomeVsExpenses).toHaveLength(2);
    expect(snapshot.charts.savingsGrowth.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.charts.monthlyComparisons).toHaveLength(1);
  });

  it('advances recurring schedule dates deterministically', () => {
    expect(computeNextRunDate('2026-11-19', 'daily', 1)).toBe('2026-11-20');
    expect(computeNextRunDate('2026-11-19', 'weekly', 1)).toBe('2026-11-26');
    expect(computeNextRunDate('2026-11-19', 'monthly', 1)).toBe('2026-12-19');
    expect(computeNextRunDate('2026-11-19', 'yearly', 1)).toBe('2027-11-19');
  });
});
