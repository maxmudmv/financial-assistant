import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  CheckCircle2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { GlassBadge } from '@/components/glass/GlassBadge';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { GlassSelect } from '@/components/glass/GlassSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { formatDateTime, formatMoney } from '@/i18n/formatters';
import {
  createManualExchangeRate,
  createTransfer,
  fetchAccounts,
  fetchExchangeRates,
  fetchTransfers,
  generateIdempotencyKey,
  refreshExchangeRates,
  voidTransfer,
} from '@/services/financeService';

const TransferFormSchema = z
  .object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    fromAmount: z.string().regex(/^\d+(\.\d{1,4})?$/),
    exchangeRate: z.string().optional(),
    feeAmount: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0'),
    notes: z.string().max(500).optional(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    path: ['toAccountId'],
    message: 'same_account',
  });

type TransferFormValues = z.infer<typeof TransferFormSchema>;

const ManualRateFormSchema = z
  .object({
    baseCurrency: z.string().length(3),
    quoteCurrency: z.string().length(3),
    rate: z.string().regex(/^\d+(\.\d{1,8})?$/),
  })
  .refine((v) => v.baseCurrency !== v.quoteCurrency, {
    path: ['quoteCurrency'],
    message: 'same_currency',
  });

type ManualRateValues = z.infer<typeof ManualRateFormSchema>;

export function TransfersPage() {
  const { activeWorkspace } = useAuth();
  const { language, t } = useI18n();
  const queryClient = useQueryClient();

  const workspaceId = activeWorkspace?.id ?? '';
  const canWrite = activeWorkspace?.role !== 'read_only';

  const [transferError, setTransferError] = useState<string | null>(null);
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateIdempotencyKey());

  const accountsQuery = useQuery({
    queryKey: ['accounts', workspaceId],
    queryFn: () => fetchAccounts(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const transfersQuery = useQuery({
    queryKey: ['transfers', workspaceId],
    queryFn: () => fetchTransfers(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const ratesQuery = useQuery({
    queryKey: ['exchange-rates', workspaceId],
    queryFn: () => fetchExchangeRates(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const transferForm = useForm<TransferFormValues>({
    resolver: zodResolver(TransferFormSchema),
    defaultValues: {
      fromAccountId: '',
      toAccountId: '',
      fromAmount: '',
      exchangeRate: '',
      feeAmount: '0',
      notes: '',
    },
  });

  const manualRateForm = useForm<ManualRateValues>({
    resolver: zodResolver(ManualRateFormSchema),
    defaultValues: {
      baseCurrency: 'USD',
      quoteCurrency: 'UZS',
      rate: '',
    },
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const fromId = transferForm.watch('fromAccountId');
  const toId = transferForm.watch('toAccountId');
  const fromAccount = accounts.find((a) => a.id === fromId);
  const toAccount = accounts.find((a) => a.id === toId);
  const isCrossCurrency = Boolean(
    fromAccount && toAccount && fromAccount.currency !== toAccount.currency,
  );

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['transfers', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['transactions', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['ledger', workspaceId] });
  };

  const transferMutation = useMutation({
    mutationFn: (vals: TransferFormValues) =>
      createTransfer(
        workspaceId,
        {
          fromAccountId: vals.fromAccountId,
          toAccountId: vals.toAccountId,
          fromAmount: vals.fromAmount,
          exchangeRate: isCrossCurrency && vals.exchangeRate ? vals.exchangeRate : undefined,
          feeAmount: vals.feeAmount || '0',
          notes: vals.notes || undefined,
        },
        idempotencyKey,
      ),
    onSuccess: () => {
      invalidateAll();
      setTransferError(null);
      setIdempotencyKey(generateIdempotencyKey());
      transferForm.reset({
        fromAccountId: '',
        toAccountId: '',
        fromAmount: '',
        exchangeRate: '',
        feeAmount: '0',
        notes: '',
      });
    },
    onError: (err) => {
      setTransferError(err instanceof Error ? err.message : t.errors.unexpected);
    },
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) => voidTransfer(workspaceId, id),
    onSuccess: () => invalidateAll(),
  });

  const refreshRatesMutation = useMutation({
    mutationFn: () => refreshExchangeRates(workspaceId),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['exchange-rates', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
      setRateNotice(res.refreshed ? null : t.transfers.providerUnavailable);
    },
  });

  const manualRateMutation = useMutation({
    mutationFn: (vals: ManualRateValues) => createManualExchangeRate(workspaceId, vals),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exchange-rates', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
      setShowManualForm(false);
      manualRateForm.reset({ baseCurrency: 'USD', quoteCurrency: 'UZS', rate: '' });
    },
  });

  return (
    <div className="flex flex-col gap-5 pb-20">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {t.transfers.title}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t.transfers.subtitle}</p>
      </div>

      {/* New Transfer Form */}
      {canWrite && (
        <GlassCard>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-blue-500" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t.transfers.newTransfer}
              </h2>
            </div>
          </div>

          <form
            onSubmit={transferForm.handleSubmit((vals) => transferMutation.mutate(vals))}
            className="grid gap-3 sm:grid-cols-2"
          >
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-zinc-300">
                {t.transfers.fromAccount}
              </label>
              <GlassSelect
                label={t.transfers.fromAccount}
                value={transferForm.watch('fromAccountId')}
                onChange={(val) =>
                  transferForm.setValue('fromAccountId', val, { shouldValidate: true })
                }
                options={[
                  { value: '', label: '—' },
                  ...accounts.map((acc) => ({
                    value: acc.id,
                    label: `${acc.name} (${acc.currentBalance} ${acc.currency})`,
                  })),
                ]}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-zinc-300">
                {t.transfers.toAccount}
              </label>
              <GlassSelect
                label={t.transfers.toAccount}
                value={transferForm.watch('toAccountId')}
                onChange={(val) =>
                  transferForm.setValue('toAccountId', val, { shouldValidate: true })
                }
                options={[
                  { value: '', label: '—' },
                  ...accounts.map((acc) => ({
                    value: acc.id,
                    label: `${acc.name} (${acc.currentBalance} ${acc.currency})`,
                  })),
                ]}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t.transfers.fromAmount} {fromAccount ? `(${fromAccount.currency})` : ''}
              </label>
              <input
                {...transferForm.register('fromAmount')}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 font-mono text-sm text-slate-900 outline-none dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t.transfers.feeAmount}
              </label>
              <input
                {...transferForm.register('feeAmount')}
                inputMode="decimal"
                className="w-full rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 font-mono text-sm text-slate-900 outline-none dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
              />
            </div>

            {isCrossCurrency && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {t.transfers.exchangeRate} (1 {fromAccount?.currency} → {toAccount?.currency})
                </label>
                <input
                  {...transferForm.register('exchangeRate')}
                  inputMode="decimal"
                  placeholder="Auto (cached rate)"
                  className="w-full rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 font-mono text-sm text-slate-900 outline-none dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
                />
              </div>
            )}

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t.transfers.notesLabel}
              </label>
              <input
                {...transferForm.register('notes')}
                className="w-full rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
              />
            </div>

            {transferError && (
              <p className="text-xs text-rose-500 sm:col-span-2">{transferError}</p>
            )}

            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t.transfers.notCountedNote}
              </p>
              <GlassButton type="submit" disabled={transferMutation.isPending}>
                {t.transfers.submitTransfer}
              </GlassButton>
            </div>
          </form>
        </GlassCard>
      )}

      {/* Multi-Currency Exchange Rates Panel */}
      <GlassCard>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t.transfers.ratesTitle}
          </h2>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <GlassButton
                variant="secondary"
                size="sm"
                disabled={refreshRatesMutation.isPending}
                onClick={() => refreshRatesMutation.mutate()}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshRatesMutation.isPending ? 'animate-spin' : ''}`}
                />
                {t.transfers.refreshRates}
              </GlassButton>
              <GlassButton
                variant="secondary"
                size="sm"
                onClick={() => setShowManualForm((prev) => !prev)}
              >
                <Plus className="h-3.5 w-3.5" />
                {t.transfers.addManualRate}
              </GlassButton>
            </div>
          )}
        </div>

        {rateNotice && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{rateNotice}</span>
          </div>
        )}

        {showManualForm && (
          <form
            onSubmit={manualRateForm.handleSubmit((vals) => manualRateMutation.mutate(vals))}
            className="mt-4 grid gap-3 rounded-2xl border border-slate-300/35 p-3.5 sm:grid-cols-4 dark:border-white/10"
          >
            <GlassSelect
              label={t.transfers.ratesTitle}
              value={manualRateForm.watch('baseCurrency')}
              onChange={(val) =>
                manualRateForm.setValue('baseCurrency', val, { shouldValidate: true })
              }
              options={(ratesQuery.data?.supportedCurrencies ?? ['USD', 'EUR', 'RUB', 'GBP', 'UZS']).map(
                (c) => ({ value: c, label: c }),
              )}
            />

            <GlassSelect
              label={t.transfers.ratesTitle}
              value={manualRateForm.watch('quoteCurrency')}
              onChange={(val) =>
                manualRateForm.setValue('quoteCurrency', val, { shouldValidate: true })
              }
              options={(ratesQuery.data?.supportedCurrencies ?? ['UZS', 'USD', 'EUR', 'RUB', 'GBP']).map(
                (c) => ({ value: c, label: c }),
              )}
            />

            <input
              {...manualRateForm.register('rate')}
              inputMode="decimal"
              placeholder={t.transfers.rateValue}
              className="rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 font-mono text-xs text-slate-900 dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
            />

            <GlassButton type="submit" size="sm" disabled={manualRateMutation.isPending}>
              {t.common.save}
            </GlassButton>
          </form>
        )}

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {(ratesQuery.data?.matrix ?? []).map((item) => (
            <div
              key={`${item.baseCurrency}-${item.quoteCurrency}`}
              className="flex items-center justify-between rounded-2xl border border-slate-300/35 bg-slate-900/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div>
                <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                  1 {item.baseCurrency} ={' '}
                  {item.resolved ? Number(item.resolved.rate).toFixed(2) : '—'}{' '}
                  {item.quoteCurrency}
                </p>
                {item.resolved && (
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {t.transfers.sourceLabel}: {item.resolved.source} •{' '}
                    {formatDateTime(item.resolved.fetchedAt, language)}
                  </p>
                )}
              </div>

              {item.resolved && (
                <GlassBadge
                  tone={
                    item.resolved.isManual
                      ? 'violet'
                      : item.resolved.isOutdated
                        ? 'amber'
                        : 'emerald'
                  }
                >
                  {item.resolved.isManual ? (
                    t.transfers.manualBadge
                  ) : item.resolved.isOutdated ? (
                    t.transfers.outdatedBadge
                  ) : (
                    <>
                      <CheckCircle2 className="h-3 w-3" />
                      {t.transfers.freshBadge}
                    </>
                  )}
                </GlassBadge>
              )}
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Transfer History */}
      <GlassCard>
        <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
          {t.transfers.historyTitle}
        </h2>

        {transfersQuery.isLoading ? (
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        ) : transfersQuery.data && transfersQuery.data.transfers.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {transfersQuery.data.transfers.map((tr) => (
              <div
                key={tr.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-300/35 p-3.5 dark:border-white/10"
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <span>
                      {tr.fromAccountName} → {tr.toAccountName}
                    </span>
                    {tr.status === 'voided' && (
                      <GlassBadge tone="amber">{t.transactions.voidedBadge}</GlassBadge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {formatDateTime(tr.occurredAt, language)}
                    {tr.notes ? ` • ${tr.notes}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right font-mono text-xs">
                    <p className="font-bold text-rose-500">
                      −{formatMoney(tr.fromAmount, tr.fromCurrency, language)}
                    </p>
                    <p className="font-bold text-emerald-500">
                      +{formatMoney(tr.toAmount, tr.toCurrency, language)}
                    </p>
                  </div>

                  {canWrite && tr.status === 'posted' && (
                    <GlassButton
                      variant="danger"
                      size="sm"
                      disabled={voidMutation.isPending}
                      onClick={() => voidMutation.mutate(tr.id)}
                    >
                      <Ban className="h-3.5 w-3.5" />
                      {t.transfers.voidTransfer}
                    </GlassButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">{t.common.noData}</p>
        )}
      </GlassCard>
    </div>
  );
}
