import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Lock, RotateCcw } from 'lucide-react';
import { GlassBadge } from '@/components/glass/GlassBadge';
import { GlassCard } from '@/components/glass/GlassCard';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { formatDateTime, formatMoney } from '@/i18n/formatters';
import { fetchAccounts, fetchLedgerEntries } from '@/services/financeService';

export function LedgerPage() {
  const { activeWorkspace } = useAuth();
  const { language, t } = useI18n();
  const workspaceId = activeWorkspace?.id ?? '';

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  const accountsQuery = useQuery({
    queryKey: ['accounts', workspaceId],
    queryFn: () => fetchAccounts(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const ledgerQuery = useQuery({
    queryKey: ['ledger', workspaceId, selectedAccountId],
    queryFn: () => fetchLedgerEntries(workspaceId, selectedAccountId || undefined),
    enabled: Boolean(workspaceId),
  });

  return (
    <div className="flex flex-col gap-5 pb-20">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {t.ledger.title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t.ledger.subtitle}</p>
        </div>

        <select
          aria-label={t.ledger.filterByAccount}
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="liquid-glass-pill rounded-2xl px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none dark:text-white"
        >
          <option value="">{t.common.all}</option>
          {(accountsQuery.data?.accounts ?? []).map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name} ({acc.currency})
            </option>
          ))}
        </select>
      </div>

      <GlassCard padding="sm">
        <div className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <span>{t.ledger.immutableNotice}</span>
        </div>
      </GlassCard>

      {ledgerQuery.isLoading ? (
        <GlassCard>
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        </GlassCard>
      ) : ledgerQuery.data && ledgerQuery.data.entries.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {ledgerQuery.data.entries.map((entry) => {
            const isCredit = entry.direction === 'credit';
            return (
              <GlassCard key={entry.id} padding="sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-xl ${
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {entry.accountName || entry.accountId.slice(0, 8)}
                        </span>
                        <GlassBadge tone={isCredit ? 'emerald' : 'neutral'}>
                          {isCredit ? t.ledger.directionCredit : t.ledger.directionDebit}
                        </GlassBadge>
                        {entry.isReversal && (
                          <GlassBadge tone="amber">
                            <RotateCcw className="h-3 w-3" />
                            {t.ledger.reversalBadge}
                          </GlassBadge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {formatDateTime(entry.createdAt, language)}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p
                      className={`font-mono text-sm font-extrabold ${
                        isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'
                      }`}
                    >
                      {isCredit ? '+' : '−'}
                      {formatMoney(entry.amount, entry.currency, language)}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {t.ledger.balanceAfter}:{' '}
                      {formatMoney(entry.balanceAfter, entry.currency, language)}
                    </p>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      ) : (
        <GlassCard>
          <p className="text-sm text-slate-500">{t.common.noData}</p>
        </GlassCard>
      )}
    </div>
  );
}
