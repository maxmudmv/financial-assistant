import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CreditCard,
  EyeOff,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Wallet,
  X,
} from 'lucide-react';
import { GlassBadge } from '@/components/glass/GlassBadge';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { GlassSelect } from '@/components/glass/GlassSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { formatDateTime, formatMoney } from '@/i18n/formatters';
import {
  createAccount,
  fetchAccounts,
  runReconciliation,
  updateAccount,
} from '@/services/financeService';
import type { AccountType, AccountVisibility, FinanceAccount } from '@/types/finance';

const CURRENCY_OPTIONS = [
  'UZS',
  'USD',
  'EUR',
  'RUB',
  'GBP',
  'KZT',
  'TRY',
  'AED',
  'CNY',
  'CHF',
  'CAD',
  'JPY',
];

const ACCOUNT_TYPES: AccountType[] = [
  'cash',
  'bank_card',
  'bank_account',
  'savings',
  'e_wallet',
  'investment',
  'credit',
  'other',
];

const AccountFormSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum([
    'cash',
    'bank_card',
    'bank_account',
    'savings',
    'investment',
    'e_wallet',
    'credit',
    'other',
  ]),
  currency: z.string().trim().length(3),
  openingBalance: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
  visibility: z.enum(['workspace', 'private', 'selected_members']),
  includeInNetWorth: z.boolean(),
});

type AccountFormValues = z.infer<typeof AccountFormSchema>;

export function AccountsPage() {
  const { activeWorkspace } = useAuth();
  const { language, t } = useI18n();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [showReconcile, setShowReconcile] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const workspaceId = activeWorkspace?.id ?? '';
  const canWrite = activeWorkspace?.role !== 'read_only';

  const accountsQuery = useQuery({
    queryKey: ['accounts', workspaceId],
    queryFn: () => fetchAccounts(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const reconcileQuery = useQuery({
    queryKey: ['reconcile', workspaceId],
    queryFn: () => runReconciliation(workspaceId),
    enabled: Boolean(workspaceId) && showReconcile,
  });

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(AccountFormSchema),
    defaultValues: {
      name: '',
      type: 'bank_card',
      currency: activeWorkspace?.defaultCurrency ?? 'UZS',
      openingBalance: '0',
      visibility: 'workspace',
      includeInNetWorth: true,
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: AccountFormValues) => {
      if (editingAccount) {
        return updateAccount(workspaceId, editingAccount.id, {
          name: values.name,
          type: values.type,
          visibility: values.visibility,
          includeInNetWorth: values.includeInNetWorth,
        });
      }
      return createAccount(workspaceId, values);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
      setModalOpen(false);
      setEditingAccount(null);
      setFormError(null);
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : t.errors.unexpected);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (acc: FinanceAccount) =>
      updateAccount(workspaceId, acc.id, { isArchived: !acc.isArchived }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
    },
  });

  const openCreateModal = () => {
    setEditingAccount(null);
    setFormError(null);
    form.reset({
      name: '',
      type: 'bank_card',
      currency: activeWorkspace?.defaultCurrency ?? 'UZS',
      openingBalance: '0',
      visibility: 'workspace',
      includeInNetWorth: true,
    });
    setModalOpen(true);
  };

  const openEditModal = (acc: FinanceAccount) => {
    setEditingAccount(acc);
    setFormError(null);
    form.reset({
      name: acc.name,
      type: acc.type,
      currency: acc.currency,
      openingBalance: acc.openingBalance,
      visibility: acc.visibility,
      includeInNetWorth: acc.includeInNetWorth,
    });
    setModalOpen(true);
  };

  const data = accountsQuery.data;

  return (
    <div className="flex flex-col gap-5 pb-20">
      {/* Header + Actions */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {t.accounts.title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t.accounts.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <GlassButton
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowReconcile((prev) => !prev);
              if (showReconcile) void reconcileQuery.refetch();
            }}
          >
            <Scale className="h-4 w-4" />
            {t.accounts.reconcileButton}
          </GlassButton>

          {canWrite && (
            <GlassButton size="sm" onClick={openCreateModal}>
              <Plus className="h-4 w-4" />
              {t.accounts.addAccount}
            </GlassButton>
          )}
        </div>
      </div>

      {/* Consolidated Multi-Currency Summary */}
      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <GlassCard>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t.accounts.totalBalance} ({data.reportingCurrency})
            </p>
            <p className="mt-2 font-mono text-2xl font-extrabold text-slate-900 dark:text-white sm:text-3xl">
              {formatMoney(data.summary.totalBalance, data.reportingCurrency, language)}
            </p>
            {data.summary.hasOutdatedRates && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t.accounts.outdatedRatesNotice}</span>
              </div>
            )}
            {data.summary.missingRateCurrencies.length > 0 && (
              <p className="mt-2 text-xs text-rose-500">
                {t.accounts.missingRatesNotice} {data.summary.missingRateCurrencies.join(', ')}
              </p>
            )}
          </GlassCard>

          <GlassCard>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t.accounts.netWorth} ({data.reportingCurrency})
            </p>
            <p className="mt-2 font-mono text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 sm:text-3xl">
              {formatMoney(data.summary.netWorth, data.reportingCurrency, language)}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <GlassBadge tone="blue">
                {data.summary.accountCount} {t.accounts.title}
              </GlassBadge>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Reconciliation Verification Drawer */}
      <AnimatePresence>
        {showReconcile && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <GlassCard>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="h-5 w-5 text-blue-500" />
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {t.accounts.reconcileTitle}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <GlassButton
                    variant="ghost"
                    size="sm"
                    onClick={() => void reconcileQuery.refetch()}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </GlassButton>
                  <GlassButton variant="ghost" size="sm" onClick={() => setShowReconcile(false)}>
                    <X className="h-4 w-4" />
                  </GlassButton>
                </div>
              </div>

              {reconcileQuery.isLoading ? (
                <p className="mt-4 text-sm text-slate-500">{t.common.loading}</p>
              ) : reconcileQuery.data ? (
                <div className="mt-4 flex flex-col gap-3">
                  <GlassBadge tone={reconcileQuery.data.allBalanced ? 'emerald' : 'amber'}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {reconcileQuery.data.allBalanced
                      ? t.accounts.reconcileBalanced
                      : t.accounts.reconcileDiscrepancy}
                  </GlassBadge>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {reconcileQuery.data.accounts.map((item) => (
                      <div
                        key={item.accountId}
                        className="rounded-2xl border border-slate-300/35 bg-slate-900/[0.02] p-3 text-xs dark:border-white/10 dark:bg-white/[0.03]"
                      >
                        <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                          <span>{item.accountName}</span>
                          <GlassBadge tone={item.isBalanced ? 'emerald' : 'amber'}>
                            {item.isBalanced ? '0.00' : item.discrepancy} {item.currency}
                          </GlassBadge>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-1 text-slate-600 dark:text-slate-400">
                          <span>
                            {t.accounts.openingBalance}: {item.openingBalance}
                          </span>
                          <span>
                            {t.accounts.expectedBalance}: {item.expectedBalance}
                          </span>
                          <span>
                            {t.accounts.currentBalance}: {item.recordedBalance}
                          </span>
                          <span>
                            {t.accounts.ledgerEntriesCount}: {item.entryCount}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Account Cards */}
      {accountsQuery.isLoading ? (
        <GlassCard>
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        </GlassCard>
      ) : data && data.accounts.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.accounts.map((acc) => {
            const Icon =
              acc.type === 'bank_card' || acc.type === 'credit'
                ? CreditCard
                : acc.type === 'bank_account' || acc.type === 'savings'
                  ? Landmark
                  : Wallet;

            return (
              <GlassCard key={acc.id} className="flex flex-col justify-between">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 text-blue-600 dark:text-blue-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        {acc.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t.accounts.types[acc.type]} • {acc.currency}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {acc.visibility === 'private' && (
                      <GlassBadge tone="violet">
                        <EyeOff className="h-3 w-3" />
                        {t.accounts.visibility.private}
                      </GlassBadge>
                    )}
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditModal(acc)}
                          aria-label={t.common.edit}
                          className="rounded-xl p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-blue-500"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => archiveMutation.mutate(acc)}
                          aria-label={t.accounts.archive}
                          className="rounded-xl p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-amber-500"
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-5">
                  <p className="font-mono text-2xl font-extrabold text-slate-900 dark:text-white">
                    {formatMoney(acc.currentBalance, acc.currency, language)}
                  </p>
                  {acc.convertedBalance &&
                    acc.reportingCurrency &&
                    acc.reportingCurrency !== acc.currency && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>
                          ≈ {formatMoney(acc.convertedBalance, acc.reportingCurrency, language)}
                        </span>
                        {acc.exchangeRate?.isOutdated && (
                          <GlassBadge tone="amber">{t.transfers.outdatedBadge}</GlassBadge>
                        )}
                        {acc.exchangeRate && (
                          <span className="text-[11px] opacity-80">
                            ({acc.exchangeRate.source} •{' '}
                            {formatDateTime(acc.exchangeRate.fetchedAt, language)})
                          </span>
                        )}
                      </div>
                    )}
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

      {/* Create / Edit Account Modal */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 12 }}
              className="w-full max-w-md"
            >
              <GlassCard padding="lg">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    {editingAccount ? t.accounts.editAccount : t.accounts.addAccount}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-xl p-1 text-slate-400 hover:text-slate-200"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form
                  onSubmit={form.handleSubmit((vals) => saveMutation.mutate(vals))}
                  className="flex flex-col gap-3.5"
                >
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {t.accounts.nameLabel}
                    </label>
                    <input
                      {...form.register('name')}
                      className="w-full rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-zinc-300">
                        {t.accounts.typeLabel}
                      </label>
                      <GlassSelect
                        label={t.accounts.typeLabel}
                        value={form.watch('type')}
                        onChange={(val) =>
                          form.setValue('type', val as AccountType, { shouldValidate: true })
                        }
                        options={ACCOUNT_TYPES.map((typeKey) => ({
                          value: typeKey,
                          label: t.accounts.types[typeKey],
                        }))}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-zinc-300">
                        {t.accounts.currencyLabel}
                      </label>
                      <GlassSelect
                        label={t.accounts.currencyLabel}
                        disabled={Boolean(editingAccount)}
                        value={form.watch('currency')}
                        onChange={(val) =>
                          form.setValue('currency', val, { shouldValidate: true })
                        }
                        options={CURRENCY_OPTIONS.map((curr) => ({
                          value: curr,
                          label: curr,
                        }))}
                      />
                    </div>
                  </div>

                  {!editingAccount && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {t.accounts.openingBalance}
                      </label>
                      <input
                        {...form.register('openingBalance')}
                        inputMode="decimal"
                        className="w-full rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
                      />
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-zinc-300">
                      {t.accounts.visibilityLabel}
                    </label>
                    <GlassSelect
                      label={t.accounts.visibilityLabel}
                      value={form.watch('visibility')}
                      onChange={(val) =>
                        form.setValue('visibility', val as AccountVisibility, {
                          shouldValidate: true,
                        })
                      }
                      options={(['workspace', 'private'] as AccountVisibility[]).map((vis) => ({
                        value: vis,
                        label: t.accounts.visibility[vis],
                      }))}
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <input type="checkbox" {...form.register('includeInNetWorth')} />
                    {t.accounts.includeInNetWorth}
                  </label>

                  {formError && <p className="text-xs text-rose-500">{formError}</p>}

                  <div className="mt-2 flex justify-end gap-2">
                    <GlassButton variant="ghost" onClick={() => setModalOpen(false)}>
                      {t.common.cancel}
                    </GlassButton>
                    <GlassButton type="submit" disabled={saveMutation.isPending}>
                      {editingAccount ? t.common.save : t.common.create}
                    </GlassButton>
                  </div>
                </form>
              </GlassCard>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
