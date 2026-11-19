import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CalendarClock,
  CheckCheck,
  PiggyBank,
  Plus,
  TrendingUp,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { GlassBadge } from '@/components/glass/GlassBadge';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { formatDateTime, formatMoney } from '@/i18n/formatters';
import {
  fetchAnalytics,
  fetchNotifications,
  markNotificationsRead,
} from '@/services/planningService';
import type { AnalyticsPeriod } from '@/types/planning';
import { cn } from '@/lib/cn';

const PERIODS: AnalyticsPeriod[] = ['today', 'week', 'month', 'last_month', 'year', 'custom'];

export function DashboardPage() {
  const { activeWorkspace, workspaces, switchWorkspace, settings } = useAuth();
  const { language, t } = useI18n();
  const queryClient = useQueryClient();

  const workspaceId = activeWorkspace?.id ?? '';
  const [period, setPeriod] = useState<AnalyticsPeriod>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);

  const analyticsQuery = useQuery({
    queryKey: ['analytics', workspaceId, period, customFrom, customTo],
    queryFn: () =>
      fetchAnalytics(workspaceId, period, {
        from: period === 'custom' && customFrom ? `${customFrom}T00:00:00.000Z` : undefined,
        to: period === 'custom' && customTo ? `${customTo}T23:59:59.999Z` : undefined,
      }),
    enabled: Boolean(workspaceId),
  });

  const notificationsQuery = useQuery({
    queryKey: ['notifications', workspaceId],
    queryFn: () => fetchNotifications(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const markReadMutation = useMutation({
    mutationFn: () => markNotificationsRead(workspaceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', workspaceId] });
    },
  });

  const data = analyticsQuery.data;
  const currency = data?.reportingCurrency ?? activeWorkspace?.defaultCurrency ?? 'UZS';
  const hideBalances = Boolean(settings?.hideBalances);
  const mask = (formatted: string) => (hideBalances ? '••••••' : formatted);

  return (
    <div className="flex flex-col gap-5 pb-24">
      {/* Top Workspace Switcher + Notifications */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {t.dashboard.title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t.dashboard.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && (
            <div className="liquid-glass-pill inline-flex items-center gap-1 rounded-full p-1">
              {workspaces.map((ws) => {
                const active = ws.id === activeWorkspace?.id;
                const Icon = ws.type === 'family' ? Users : User;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => void switchWorkspace(ws.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition',
                      active
                        ? 'bg-gradient-to-r from-blue-500 to-violet-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {ws.name}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowNotifications((p) => !p)}
            aria-label={t.dashboard.notificationsTitle}
            className="liquid-glass-pill relative flex h-9 w-9 items-center justify-center rounded-full text-slate-700 dark:text-slate-200"
          >
            <Bell className="h-4 w-4" />
            {(notificationsQuery.data?.unreadCount ?? 0) > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {notificationsQuery.data?.unreadCount}
              </span>
            )}
          </button>

          <Link to="/transactions">
            <GlassButton size="sm">
              <Plus className="h-4 w-4" />
              {t.transactions.addTransaction}
            </GlassButton>
          </Link>
        </div>
      </div>

      {/* Notification Center Drawer */}
      {showNotifications && (
        <GlassCard padding="sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t.dashboard.notificationsTitle}
            </h2>
            <GlassButton
              variant="ghost"
              size="sm"
              onClick={() => markReadMutation.mutate()}
              disabled={markReadMutation.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t.dashboard.markAllRead}
            </GlassButton>
          </div>

          {(notificationsQuery.data?.notifications ?? []).length === 0 ? (
            <p className="text-xs text-slate-500">{t.common.noData}</p>
          ) : (
            <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
              {(notificationsQuery.data?.notifications ?? []).map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-xs',
                    n.read_at
                      ? 'border-slate-300/25 opacity-70 dark:border-white/5'
                      : 'border-blue-500/35 bg-blue-500/10',
                  )}
                >
                  <p className="font-bold text-slate-900 dark:text-white">{n.title}</p>
                  <p className="mt-0.5 text-slate-600 dark:text-slate-300">{n.body}</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {formatDateTime(n.created_at, language)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Period Filter Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="liquid-glass-pill inline-flex flex-wrap items-center gap-1 rounded-2xl p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={cn(
                'rounded-xl px-3 py-1.5 text-xs font-semibold transition',
                period === p
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
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

      {/* Hero Liquid Glass Balance & Net Worth Card */}
      {analyticsQuery.isLoading ? (
        <GlassCard>
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        </GlassCard>
      ) : data ? (
        <>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-4 lg:grid-cols-3"
          >
            <GlassCard className="lg:col-span-2 bg-gradient-to-br from-blue-500/15 via-violet-500/10 to-emerald-500/10">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {t.accounts.totalBalance} ({currency})
                  </p>
                  <p className="mt-2 font-mono text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
                    {mask(formatMoney(data.kpis.totalBalance, currency, language))}
                  </p>
                </div>
                <GlassBadge tone="emerald">
                  <Wallet className="h-3.5 w-3.5" />
                  {t.accounts.netWorth}: {mask(formatMoney(data.kpis.netWorth, currency, language))}
                </GlassBadge>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl border border-white/15 bg-white/30 p-3 dark:bg-white/[0.04]">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t.dashboard.income}
                  </p>
                  <p className="mt-1 font-mono text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                    +{mask(formatMoney(data.kpis.totalIncome, currency, language))}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/15 bg-white/30 p-3 dark:bg-white/[0.04]">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t.dashboard.expenses}
                  </p>
                  <p className="mt-1 font-mono text-sm font-extrabold text-rose-500">
                    −{mask(formatMoney(data.kpis.totalExpenses, currency, language))}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/15 bg-white/30 p-3 dark:bg-white/[0.04]">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t.dashboard.cashFlow}
                  </p>
                  <p className="mt-1 font-mono text-sm font-extrabold text-blue-600 dark:text-blue-400">
                    {mask(formatMoney(data.kpis.netCashFlow, currency, language))}
                  </p>
                </div>

                <div className="rounded-2xl border border-white/15 bg-white/30 p-3 dark:bg-white/[0.04]">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t.dashboard.savings}
                  </p>
                  <p className="mt-1 font-mono text-sm font-extrabold text-violet-600 dark:text-violet-400">
                    {mask(formatMoney(data.kpis.savingsTotal, currency, language))}
                  </p>
                </div>
              </div>
            </GlassCard>

            {/* Monthly Budget Progress Card */}
            <GlassCard className="flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {t.dashboard.monthlyBudget}
                  </p>
                  <GlassBadge
                    tone={
                      data.kpis.budgetUsagePct >= 90
                        ? 'amber'
                        : data.kpis.budgetUsagePct > 0
                          ? 'blue'
                          : 'neutral'
                    }
                  >
                    {data.kpis.budgetUsagePct}%
                  </GlassBadge>
                </div>
                <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 via-violet-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${Math.min(100, data.kpis.budgetUsagePct)}%` }}
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t.analytics.savingsRate}: {data.kpis.savingsRate}%
                </span>
                <Link
                  to="/analytics"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-500 hover:underline"
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  {t.nav.analytics}
                </Link>
              </div>
            </GlassCard>
          </motion.div>

          {/* Lower Dashboard Grid: Recent Transactions, Upcoming Payments, Savings Goals */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Recent Transactions */}
            <GlassCard className="lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {t.dashboard.recentTransactions}
                </h2>
                <Link
                  to="/transactions"
                  className="text-xs font-semibold text-blue-500 hover:underline"
                >
                  {t.dashboard.viewAll}
                </Link>
              </div>

              {data.recentTransactions.length === 0 ? (
                <p className="text-sm text-slate-500">{t.common.noData}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.recentTransactions.map((tx) => {
                    const isCredit = tx.type === 'income' || tx.type === 'refund';
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between rounded-2xl border border-slate-300/30 px-3 py-2.5 dark:border-white/10"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                              isCredit
                                ? 'bg-emerald-500/15 text-emerald-500'
                                : 'bg-rose-500/15 text-rose-500'
                            }`}
                          >
                            {isCredit ? (
                              <ArrowDownLeft className="h-4 w-4" />
                            ) : (
                              <ArrowUpRight className="h-4 w-4" />
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900 dark:text-white">
                              {tx.description || tx.type}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {tx.accountName} • {formatDateTime(tx.occurredAt, language)}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`font-mono text-xs font-extrabold ${
                            isCredit ? 'text-emerald-500' : 'text-rose-500'
                          }`}
                        >
                          {isCredit ? '+' : '−'}
                          {mask(formatMoney(tx.amount, tx.currency, language))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </GlassCard>

            {/* Right Column: Upcoming Payments + Active Savings Goals */}
            <div className="flex flex-col gap-4">
              <GlassCard>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-violet-500" />
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                      {t.dashboard.upcomingPayments}
                    </h2>
                  </div>
                  <Link
                    to="/planning"
                    className="text-xs font-semibold text-blue-500 hover:underline"
                  >
                    {t.dashboard.viewAll}
                  </Link>
                </div>

                {data.upcomingPayments.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.common.noData}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {data.upcomingPayments.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-xl border border-slate-300/30 px-3 py-2 text-xs dark:border-white/10"
                      >
                        <div>
                          <p className="font-bold text-slate-900 dark:text-white">{item.name}</p>
                          <p className="text-[11px] text-slate-500">{item.next_run_date}</p>
                        </div>
                        <span className="font-mono font-bold">
                          {mask(formatMoney(item.amount, item.currency, language))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>

              <GlassCard>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PiggyBank className="h-4 w-4 text-emerald-500" />
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                      {t.dashboard.savingsGoals}
                    </h2>
                  </div>
                  <Link
                    to="/planning"
                    className="text-xs font-semibold text-blue-500 hover:underline"
                  >
                    {t.dashboard.viewAll}
                  </Link>
                </div>

                {data.activeGoals.length === 0 ? (
                  <p className="text-xs text-slate-500">{t.common.noData}</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {data.activeGoals.map((goal) => (
                      <div key={goal.id}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {goal.name}
                          </span>
                          <span className="font-mono text-slate-500">{goal.progressPct}%</span>
                        </div>
                        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${goal.progressPct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
