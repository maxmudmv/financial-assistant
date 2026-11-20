import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { GlassBadge } from '@/components/glass/GlassBadge';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { formatMoney } from '@/i18n/formatters';
import { downloadReportExport, fetchReportsSummary } from '@/services/planningService';
import type { AnalyticsPeriod, ReportType } from '@/types/planning';
import { cn } from '@/lib/cn';
import { triggerHaptic } from '@/lib/telegram';

const REPORT_TYPES: ReportType[] = [
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'category',
  'account',
  'family',
];

const PERIODS: AnalyticsPeriod[] = ['today', 'week', 'month', 'last_month', 'year', 'custom'];

export function ReportsPage() {
  const { activeWorkspace } = useAuth();
  const { language, t } = useI18n();
  const workspaceId = activeWorkspace?.id ?? '';

  const [reportType, setReportType] = useState<ReportType>('daily');
  const [period, setPeriod] = useState<AnalyticsPeriod>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'xlsx' | 'csv' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const fromIso = period === 'custom' && customFrom ? `${customFrom}T00:00:00.000Z` : undefined;
  const toIso = period === 'custom' && customTo ? `${customTo}T23:59:59.999Z` : undefined;

  const query = useQuery({
    queryKey: ['reports', workspaceId, reportType, period, fromIso, toIso],
    queryFn: () =>
      fetchReportsSummary(workspaceId, reportType, period, {
        from: fromIso,
        to: toIso,
      }),
    enabled: Boolean(workspaceId),
  });

  const data = query.data;
  const currency = data?.reportingCurrency ?? activeWorkspace?.defaultCurrency ?? 'UZS';

  const handleExport = async (format: 'pdf' | 'xlsx' | 'csv') => {
    setExportError(null);
    setExportSuccess(null);
    setExportingFormat(format);
    try {
      const mode = await downloadReportExport(workspaceId, {
        reportType,
        period,
        format,
        from: fromIso,
        to: toIso,
      });
      triggerHaptic('success');
      if (mode === 'telegram') {
        setExportSuccess(t.reports.sentToTelegram);
      }
    } catch (err) {
      triggerHaptic('error');
      setExportError(err instanceof Error ? err.message : t.errors.unexpected);
    } finally {
      setExportingFormat(null);
    }
  };

  const timeSeries =
    reportType === 'daily'
      ? data?.reports.daily
      : reportType === 'weekly'
        ? data?.reports.weekly
        : reportType === 'yearly'
          ? data?.reports.yearly
          : data?.reports.monthly;

  return (
    <div className="flex flex-col gap-5 pb-24">
      {/* Header + Authenticated Export Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
            {t.reports.title}
          </h1>
          <p className="text-xs text-slate-600 dark:text-zinc-400 sm:text-sm">
            {t.reports.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <GlassButton
            size="sm"
            disabled={exportingFormat !== null}
            onClick={() => void handleExport('pdf')}
          >
            <FileText className="h-3.5 w-3.5" />
            {t.reports.exportPdf}
          </GlassButton>
          <GlassButton
            variant="secondary"
            size="sm"
            disabled={exportingFormat !== null}
            onClick={() => void handleExport('xlsx')}
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />
            {t.reports.exportXlsx}
          </GlassButton>
          <GlassButton
            variant="secondary"
            size="sm"
            disabled={exportingFormat !== null}
            onClick={() => void handleExport('csv')}
          >
            <Download className="h-3.5 w-3.5 text-blue-500" />
            {t.reports.exportCsv}
          </GlassButton>
        </div>
      </div>

      {exportError && (
        <GlassCard padding="sm">
          <p className="text-xs font-medium text-rose-500">{exportError}</p>
        </GlassCard>
      )}

      {exportSuccess && (
        <GlassCard padding="sm">
          <p className="text-xs font-semibold text-emerald-500">{exportSuccess}</p>
        </GlassCard>
      )}

      {/* Compact Single-Row Report Type & Period Selectors */}
      <div className="flex flex-col gap-2">
        <div className="liquid-glass-pill no-scrollbar flex w-full flex-nowrap items-center gap-1 overflow-x-auto rounded-full p-1 sm:w-fit">
          {REPORT_TYPES.map((rt) => (
            <button
              key={rt}
              type="button"
              onClick={() => setReportType(rt)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                reportType === rt
                  ? 'liquid-glass-lens text-white dark:text-slate-950'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white',
              )}
            >
              {t.reports.types[rt]}
            </button>
          ))}
        </div>

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

      {query.isLoading ? (
        <GlassCard>
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        </GlassCard>
      ) : data ? (
        <>
          {/* Summary KPI Row */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.dashboard.income}
              </p>
              <p className="mt-1 font-mono text-base font-extrabold text-emerald-600 dark:text-emerald-400 sm:text-lg">
                +{formatMoney(data.metrics.totalIncome, currency, language)}
              </p>
            </GlassCard>
            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.dashboard.expenses}
              </p>
              <p className="mt-1 font-mono text-base font-extrabold text-rose-600 dark:text-rose-400 sm:text-lg">
                −{formatMoney(data.metrics.totalExpenses, currency, language)}
              </p>
            </GlassCard>
            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.dashboard.cashFlow}
              </p>
              <p className="mt-1 font-mono text-base font-extrabold text-sky-600 dark:text-sky-400 sm:text-lg">
                {formatMoney(data.metrics.netCashFlow, currency, language)}
              </p>
            </GlassCard>
            <GlassCard padding="sm">
              <p className="text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                {t.analytics.savingsRate}
              </p>
              <p className="mt-1 font-mono text-base font-extrabold text-violet-600 dark:text-violet-400 sm:text-lg">
                {data.metrics.savingsRate}% ({data.transactionCount})
              </p>
            </GlassCard>
          </div>

          {/* Dynamic Report Table */}
          <GlassCard>
            {reportType === 'category' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-300/35 text-slate-500 dark:border-white/10">
                      <th className="pb-2">{t.reports.categoryCol}</th>
                      <th className="pb-2">{t.reports.txCountCol}</th>
                      <th className="pb-2">{t.reports.expenseCol}</th>
                      <th className="pb-2 text-right">{t.reports.shareCol}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300/20 dark:divide-white/5">
                    {data.reports.category.map((cat) => (
                      <tr key={cat.categoryId}>
                        <td className="py-2.5 font-bold text-slate-900 dark:text-white">
                          {cat.name}
                        </td>
                        <td className="py-2.5 font-mono">{cat.txCount ?? 0}</td>
                        <td className="py-2.5 font-mono font-bold text-rose-500">
                          {formatMoney(cat.amountFormatted, currency, language)}
                        </td>
                        <td className="py-2.5 text-right">
                          <GlassBadge tone="blue">{cat.sharePct}%</GlassBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : reportType === 'account' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-300/35 text-slate-500 dark:border-white/10">
                      <th className="pb-2">{t.reports.accountCol}</th>
                      <th className="pb-2">{t.reports.openingCol}</th>
                      <th className="pb-2">{t.reports.incomeCol}</th>
                      <th className="pb-2">{t.reports.expenseCol}</th>
                      <th className="pb-2 text-right">{t.reports.closingCol}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300/20 dark:divide-white/5">
                    {data.reports.account.map((acc) => (
                      <tr key={acc.accountId}>
                        <td className="py-2.5 font-bold text-slate-900 dark:text-white">
                          {acc.name} ({acc.currency})
                        </td>
                        <td className="py-2.5 font-mono">
                          {formatMoney(acc.openingBalance, acc.currency, language)}
                        </td>
                        <td className="py-2.5 font-mono text-emerald-500">
                          +{formatMoney(acc.totalInflow, acc.currency, language)}
                        </td>
                        <td className="py-2.5 font-mono text-rose-500">
                          −{formatMoney(acc.totalOutflow, acc.currency, language)}
                        </td>
                        <td className="py-2.5 text-right font-mono font-extrabold">
                          {formatMoney(acc.closingBalance, acc.currency, language)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : reportType === 'family' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-300/35 text-slate-500 dark:border-white/10">
                      <th className="pb-2">{t.reports.memberCol}</th>
                      <th className="pb-2">{t.reports.roleCol}</th>
                      <th className="pb-2">{t.reports.txCountCol}</th>
                      <th className="pb-2">{t.reports.incomeCol}</th>
                      <th className="pb-2">{t.reports.expenseCol}</th>
                      <th className="pb-2 text-right">{t.reports.netCol}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300/20 dark:divide-white/5">
                    {data.reports.family.map((m) => (
                      <tr key={m.userId}>
                        <td className="py-2.5 font-bold text-slate-900 dark:text-white">
                          {m.memberName}
                        </td>
                        <td className="py-2.5">
                          <GlassBadge>{m.role}</GlassBadge>
                        </td>
                        <td className="py-2.5 font-mono">{m.txCount}</td>
                        <td className="py-2.5 font-mono text-emerald-500">
                          +{formatMoney(m.income, currency, language)}
                        </td>
                        <td className="py-2.5 font-mono text-rose-500">
                          −{formatMoney(m.expense, currency, language)}
                        </td>
                        <td className="py-2.5 text-right font-mono font-bold">
                          {formatMoney(m.netContribution, currency, language)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-300/35 text-slate-500 dark:border-white/10">
                      <th className="pb-2">{t.reports.periodCol}</th>
                      <th className="pb-2">{t.reports.txCountCol}</th>
                      <th className="pb-2">{t.reports.incomeCol}</th>
                      <th className="pb-2">{t.reports.expenseCol}</th>
                      <th className="pb-2 text-right">{t.reports.netCol}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300/20 dark:divide-white/5">
                    {(timeSeries ?? []).map((row) => (
                      <tr key={row.periodKey}>
                        <td className="py-2.5 font-mono font-bold text-slate-900 dark:text-white">
                          {row.periodKey}
                        </td>
                        <td className="py-2.5 font-mono">{row.txCount}</td>
                        <td className="py-2.5 font-mono text-emerald-500">
                          +{formatMoney(row.income, currency, language)}
                        </td>
                        <td className="py-2.5 font-mono text-rose-500">
                          −{formatMoney(row.expense, currency, language)}
                        </td>
                        <td className="py-2.5 text-right font-mono font-bold">
                          {formatMoney(row.netCashFlow, currency, language)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </>
      ) : null}
    </div>
  );
}
