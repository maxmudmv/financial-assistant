import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { GlassCard } from '@/components/glass/GlassCard';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { formatMoney } from '@/i18n/formatters';
import { fetchAnalytics } from '@/services/planningService';
import type { AnalyticsPeriod } from '@/types/planning';
import { cn } from '@/lib/cn';

const PERIODS: AnalyticsPeriod[] = ['today', 'week', 'month', 'last_month', 'year', 'custom'];

export function AnalyticsPage() {
  const { activeWorkspace } = useAuth();
  const { language, t } = useI18n();
  const workspaceId = activeWorkspace?.id ?? '';

  const [period, setPeriod] = useState<AnalyticsPeriod>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const query = useQuery({
    queryKey: ['analytics', workspaceId, period, customFrom, customTo],
    queryFn: () =>
      fetchAnalytics(workspaceId, period, {
        from: period === 'custom' && customFrom ? `${customFrom}T00:00:00.000Z` : undefined,
        to: period === 'custom' && customTo ? `${customTo}T23:59:59.999Z` : undefined,
      }),
    enabled: Boolean(workspaceId),
  });

  const data = query.data;
  const currency = data?.reportingCurrency ?? activeWorkspace?.defaultCurrency ?? 'UZS';

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
            {t.analytics.title}
          </h1>
          <p className="text-xs text-slate-600 dark:text-zinc-400 sm:text-sm">
            {t.analytics.subtitle}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <div className="liquid-glass-pill no-scrollbar flex w-full flex-nowrap items-center gap-1 overflow-x-auto rounded-full p-1 sm:w-fit">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                  period === p
                    ? 'liquid-glass-lens text-white dark:text-slate-950'
                    : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white',
                )}
              >
                {t.dashboard.periods[p]}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-xl border border-slate-300/40 bg-white/70 px-2.5 py-1.5 text-xs dark:border-white/15 dark:bg-slate-900/60"
              />
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-xl border border-slate-300/40 bg-white/70 px-2.5 py-1.5 text-xs dark:border-white/15 dark:bg-slate-900/60"
              />
            </div>
          )}
        </div>
      </div>

      {query.isLoading ? (
        <GlassCard>
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        </GlassCard>
      ) : data ? (
        <>
          {/* All 8 Required Analytics Metrics (Compact 2-col on mobile, high contrast) */}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.dashboard.income}
              </p>
              <p className="mt-1 font-mono text-base font-extrabold text-emerald-600 dark:text-emerald-400 sm:text-lg">
                +{formatMoney(data.kpis.totalIncome, currency, language)}
              </p>
            </GlassCard>

            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.dashboard.expenses}
              </p>
              <p className="mt-1 font-mono text-base font-extrabold text-rose-600 dark:text-rose-400 sm:text-lg">
                −{formatMoney(data.kpis.totalExpenses, currency, language)}
              </p>
            </GlassCard>

            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.dashboard.cashFlow}
              </p>
              <p className="mt-1 font-mono text-base font-extrabold text-sky-600 dark:text-sky-400 sm:text-lg">
                {formatMoney(data.kpis.netCashFlow, currency, language)}
              </p>
            </GlassCard>

            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.analytics.savingsRate}
              </p>
              <p className="mt-1 font-mono text-lg font-extrabold text-emerald-600 dark:text-emerald-400 sm:text-xl">
                {data.kpis.savingsRate}%
              </p>
            </GlassCard>

            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.analytics.avgDailyExpense}
              </p>
              <p className="mt-1 font-mono text-base font-extrabold text-slate-900 dark:text-white sm:text-lg">
                {formatMoney(data.kpis.averageDailyExpenses, currency, language)}
              </p>
            </GlassCard>

            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.analytics.highestCategory}
              </p>
              <p className="mt-1 truncate text-sm font-extrabold text-violet-600 dark:text-violet-400 sm:text-base">
                {data.kpis.highestSpendingCategory?.name ?? '—'}
              </p>
              {data.kpis.highestSpendingCategory && (
                <p className="font-mono text-[11px] text-slate-600 dark:text-zinc-400">
                  {formatMoney(
                    data.kpis.highestSpendingCategory.amountFormatted,
                    currency,
                    language,
                  )}{' '}
                  ({data.kpis.highestSpendingCategory.sharePct}%)
                </p>
              )}
            </GlassCard>

            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.analytics.monthlyGrowth}
              </p>
              <p
                className={cn(
                  'mt-1 font-mono text-lg font-extrabold sm:text-xl',
                  data.kpis.monthlyGrowthPct <= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400',
                )}
              >
                {data.kpis.monthlyGrowthPct > 0 ? '+' : ''}
                {data.kpis.monthlyGrowthPct}%
              </p>
            </GlassCard>

            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.analytics.budgetUsage}
              </p>
              <p
                className={cn(
                  'mt-1 font-mono text-2xl font-extrabold',
                  data.kpis.budgetUsagePct >= 90 ? 'text-amber-500' : 'text-blue-500',
                )}
              >
                {data.kpis.budgetUsagePct}%
              </p>
            </GlassCard>
          </div>

          {/* All 9 Required Interactive Recharts Visualizations */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* 1. Income vs Expenses (Current vs Previous Period) */}
            <GlassCard>
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
                1. {t.analytics.incomeVsExpense}
              </h2>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.charts.incomeVsExpenses}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="income"
                      name={t.dashboard.income}
                      fill="#10B981"
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="expense"
                      name={t.dashboard.expenses}
                      fill="#F43F5E"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>

            {/* 2. Monthly Cash Flow (Income, Expense, Net Line) */}
            <GlassCard>
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
                2. {t.analytics.monthlyCashFlow}
              </h2>
              <div className="h-60 w-full">
                {data.charts.monthlyCashFlow.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.common.noData}</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.charts.monthlyCashFlow}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="income"
                        name={t.dashboard.income}
                        fill="#10B981"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="expense"
                        name={t.dashboard.expenses}
                        fill="#F43F5E"
                        radius={[4, 4, 0, 0]}
                      />
                      <Line
                        type="monotone"
                        dataKey="net"
                        name={t.dashboard.cashFlow}
                        stroke="#3B82F6"
                        strokeWidth={2.5}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </GlassCard>

            {/* 3. Daily Spending */}
            <GlassCard>
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
                3. {t.analytics.dailySpending}
              </h2>
              <div className="h-60 w-full">
                {data.charts.dailySpending.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.common.noData}</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.charts.dailySpending}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="expense"
                        name={t.dashboard.expenses}
                        stroke="#7C3AED"
                        fill="#7C3AED"
                        fillOpacity={0.28}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </GlassCard>

            {/* 4. Category Breakdown */}
            <GlassCard>
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
                4. {t.analytics.categoryBreakdown}
              </h2>
              {data.charts.categoryBreakdown.length === 0 ? (
                <p className="text-xs text-slate-500">{t.common.noData}</p>
              ) : (
                <div className="grid items-center gap-4 sm:grid-cols-2">
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.charts.categoryBreakdown}
                          dataKey="amount"
                          nameKey="name"
                          innerRadius={45}
                          outerRadius={76}
                          paddingAngle={3}
                        >
                          {data.charts.categoryBreakdown.map((entry) => (
                            <Cell key={entry.categoryId} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-2">
                    {data.charts.categoryBreakdown.slice(0, 6).map((cat) => (
                      <div
                        key={cat.categoryId}
                        className="flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: cat.color }}
                          />
                          <span className="truncate text-slate-700 dark:text-slate-200">
                            {cat.name}
                          </span>
                        </div>
                        <span className="font-mono font-bold">{cat.sharePct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </GlassCard>

            {/* 5. Account Distribution */}
            <GlassCard>
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
                5. {t.analytics.accountDistribution}
              </h2>
              <div className="h-60 w-full">
                {data.charts.accountDistribution.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.common.noData}</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.accountDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar
                        dataKey="convertedBalance"
                        name={`${t.accounts.currentBalance} (${currency})`}
                        radius={[6, 6, 0, 0]}
                      >
                        {data.charts.accountDistribution.map((acc) => (
                          <Cell key={acc.accountId} fill={acc.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </GlassCard>

            {/* 6. Savings Growth */}
            <GlassCard>
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
                6. {t.analytics.savingsGrowth}
              </h2>
              <div className="h-60 w-full">
                {data.charts.savingsGrowth.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.common.noData}</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.charts.savingsGrowth}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="cumulativeSavings"
                        name={t.dashboard.savings}
                        stroke="#10B981"
                        fill="#10B981"
                        fillOpacity={0.28}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </GlassCard>

            {/* 7. Net Worth History */}
            <GlassCard>
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
                7. {t.analytics.netWorthHistory}
              </h2>
              <div className="h-60 w-full">
                {data.charts.netWorthHistory.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.common.noData}</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.charts.netWorthHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="netWorth"
                        name={t.accounts.netWorth}
                        stroke="#3B82F6"
                        fill="#3B82F6"
                        fillOpacity={0.25}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </GlassCard>

            {/* 8. Budget Usage */}
            <GlassCard>
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
                8. {t.analytics.budgetUsage}
              </h2>
              <div className="h-60 w-full">
                {data.charts.budgetUsage.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.common.noData}</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.budgetUsage}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="limit"
                        name={t.planning.budgets.limitLabel}
                        fill="#3B82F6"
                        radius={[6, 6, 0, 0]}
                      />
                      <Bar
                        dataKey="spent"
                        name={t.planning.budgets.spentLabel}
                        fill="#F59E0B"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </GlassCard>

            {/* 9. Monthly / Period Comparisons by Category */}
            <GlassCard className="lg:col-span-2">
              <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
                9. {t.analytics.monthlyComparisons}
              </h2>
              <div className="h-64 w-full">
                {data.charts.monthlyComparisons.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.common.noData}</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.monthlyComparisons}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar
                        dataKey="previousExpense"
                        name={t.analytics.previousPeriod}
                        fill="#64748B"
                        radius={[6, 6, 0, 0]}
                      />
                      <Bar
                        dataKey="currentExpense"
                        name={t.analytics.currentPeriod}
                        fill="#7C3AED"
                        radius={[6, 6, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </GlassCard>
          </div>
        </>
      ) : null}
    </div>
  );
}
