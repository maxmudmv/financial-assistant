import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  EyeOff,
  Pencil,
  Plus,
  Search,
  Tag,
} from 'lucide-react';
import { GlassBadge } from '@/components/glass/GlassBadge';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import {
  GlassDateTimeInput,
  getNowLocalDateTimeValue,
  isoToLocalDateTimeValue,
  localDateTimeValueToIso,
} from '@/components/glass/GlassDateTimeInput';
import { GlassModal } from '@/components/glass/GlassModal';
import { GlassSelect } from '@/components/glass/GlassSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { formatDateTime, formatMoney } from '@/i18n/formatters';
import {
  createTransaction,
  editTransaction,
  fetchAccounts,
  fetchCategories,
  fetchTransactionDetail,
  fetchTransactions,
  generateIdempotencyKey,
  voidTransaction,
} from '@/services/financeService';
import type { FinanceCategory, FinanceTransaction, TransactionType } from '@/types/finance';

const POSTABLE_TYPES: Array<Exclude<TransactionType, 'transfer'>> = [
  'expense',
  'income',
  'refund',
  'adjustment',
];

const TxFormSchema = z.object({
  accountId: z.string().uuid(),
  categoryId: z.string().optional(),
  type: z.enum([
    'income',
    'expense',
    'refund',
    'adjustment',
    'savings_contribution',
    'savings_withdrawal',
    'debt_repayment',
  ]),
  adjustmentDirection: z.enum(['credit', 'debit']).default('credit'),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  occurredAtLocal: z.string().min(10),
  description: z.string().max(240).optional(),
  notes: z.string().max(1000).optional(),
  tagsText: z.string().max(200).optional(),
  isPrivate: z.boolean().default(false),
});

type TxFormValues = z.infer<typeof TxFormSchema>;

export function TransactionsPage() {
  const { activeWorkspace } = useAuth();
  const { language, t } = useI18n();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const workspaceId = activeWorkspace?.id ?? '';
  const canWrite = activeWorkspace?.role !== 'read_only';

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterAccountId, setFilterAccountId] = useState('');
  const [sortMode, setSortMode] = useState<'newest' | 'oldest' | 'amount'>('newest');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitIdempotencyKey, setSubmitIdempotencyKey] = useState<string>(() =>
    generateIdempotencyKey(),
  );

  const accountsQuery = useQuery({
    queryKey: ['accounts', workspaceId],
    queryFn: () => fetchAccounts(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', workspaceId],
    queryFn: () => fetchCategories(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const txQuery = useQuery({
    queryKey: ['transactions', workspaceId, search, filterType, filterAccountId, sortMode],
    queryFn: () =>
      fetchTransactions(workspaceId, {
        search,
        type: filterType,
        accountId: filterAccountId || undefined,
        sortBy: sortMode === 'amount' ? 'amount' : 'occurred_at',
        sortOrder: sortMode === 'oldest' ? 'asc' : 'desc',
      }),
    enabled: Boolean(workspaceId),
  });

  const detailQuery = useQuery({
    queryKey: ['transaction-detail', workspaceId, selectedTxId],
    queryFn: () => fetchTransactionDetail(workspaceId, selectedTxId!),
    enabled: Boolean(workspaceId) && Boolean(selectedTxId),
  });

  const form = useForm<TxFormValues>({
    resolver: zodResolver(TxFormSchema),
    defaultValues: {
      accountId: '',
      categoryId: '',
      type: 'expense',
      adjustmentDirection: 'credit',
      amount: '',
      occurredAtLocal: getNowLocalDateTimeValue(),
      description: '',
      notes: '',
      tagsText: '',
      isPrivate: false,
    },
  });

  const watchedType = form.watch('type');

  const localizeCategory = (cat: FinanceCategory): string => {
    if (language === 'ru' && cat.name_ru) return cat.name_ru;
    if (language === 'en' && cat.name_en) return cat.name_en;
    if (language === 'uz' && cat.name_uz) return cat.name_uz;
    return cat.name;
  };

  const invalidateFinance = () => {
    void queryClient.invalidateQueries({ queryKey: ['transactions', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['ledger', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['analytics', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['reports', workspaceId] });
    if (selectedTxId) {
      void queryClient.invalidateQueries({
        queryKey: ['transaction-detail', workspaceId, selectedTxId],
      });
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (values: TxFormValues) => {
      const tags = (values.tagsText ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        accountId: values.accountId,
        categoryId: values.categoryId || null,
        type: values.type,
        adjustmentDirection: values.adjustmentDirection,
        amount: values.amount,
        occurredAt: localDateTimeValueToIso(values.occurredAtLocal),
        description: values.description || undefined,
        notes: values.notes || undefined,
        tags,
        isPrivate: values.isPrivate,
      };

      if (editingTx) {
        return editTransaction(workspaceId, editingTx.id, payload);
      }
      return createTransaction(workspaceId, payload, submitIdempotencyKey);
    },
    onSuccess: () => {
      invalidateFinance();
      setModalOpen(false);
      setEditingTx(null);
      setFormError(null);
      setSubmitIdempotencyKey(generateIdempotencyKey());
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : t.errors.unexpected);
    },
  });

  const voidMutation = useMutation({
    mutationFn: (txId: string) => voidTransaction(workspaceId, txId),
    onSuccess: () => {
      invalidateFinance();
    },
  });

  const openCreateModal = () => {
    const defaultAccountId = accountsQuery.data?.accounts[0]?.id ?? '';
    setEditingTx(null);
    setFormError(null);
    setSubmitIdempotencyKey(generateIdempotencyKey());
    form.reset({
      accountId: defaultAccountId,
      categoryId: '',
      type: 'expense',
      adjustmentDirection: 'credit',
      amount: '',
      occurredAtLocal: getNowLocalDateTimeValue(),
      description: '',
      notes: '',
      tagsText: '',
      isPrivate: false,
    });
    setModalOpen(true);
  };

  const openEditModal = (tx: FinanceTransaction) => {
    setEditingTx(tx);
    setFormError(null);
    form.reset({
      accountId: tx.accountId,
      categoryId: tx.categoryId ?? '',
      type: tx.type === 'transfer' ? 'expense' : tx.type,
      adjustmentDirection: 'credit',
      amount: tx.amount,
      occurredAtLocal: isoToLocalDateTimeValue(tx.occurredAt),
      description: tx.description ?? '',
      notes: tx.notes ?? '',
      tagsText: (tx.tags ?? []).join(', '),
      isPrivate: tx.isPrivate,
    });
    setModalOpen(true);
  };

  const accounts = accountsQuery.data?.accounts ?? [];
  const categories = categoriesQuery.data?.categories ?? [];

  // Open Create Transaction modal automatically when navigated via top header `+` button
  useEffect(() => {
    if (searchParams.get('new') === '1' && canWrite && accounts.length > 0 && !modalOpen) {
      openCreateModal();
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, canWrite, accounts.length]);

  return (
    <div className="flex flex-col gap-5 pb-20">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            {t.transactions.title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t.transactions.subtitle}</p>
        </div>

        {canWrite && (
          <GlassButton size="sm" onClick={openCreateModal} disabled={accounts.length === 0}>
            <Plus className="h-4 w-4" />
            {t.transactions.addTransaction}
          </GlassButton>
        )}
      </div>

      {canWrite && !accountsQuery.isLoading && accounts.length === 0 && (
        <GlassCard padding="sm">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <p className="text-xs font-medium text-slate-600 dark:text-zinc-300">
              {t.transactions.noAccountsHint}
            </p>
            <Link to="/accounts">
              <GlassButton size="sm" variant="secondary">
                <Plus className="h-3.5 w-3.5" />
                {t.accounts.addAccount}
              </GlassButton>
            </Link>
          </div>
        </GlassCard>
      )}

      {/* Compact Search, Filter & Sort Controls */}
      <GlassCard padding="sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.transactions.searchPlaceholder}
              className="liquid-glass-input py-2 pl-9 pr-3 text-xs"
            />
          </div>

          <GlassSelect
            label={t.transactions.typeLabel}
            value={filterType}
            onChange={setFilterType}
            options={[
              { value: 'all', label: t.common.all },
              ...(['income', 'expense', 'transfer', 'refund', 'adjustment'] as TransactionType[]).map(
                (typeKey) => ({
                  value: typeKey,
                  label: t.transactions.types[typeKey],
                }),
              ),
            ]}
          />

          <GlassSelect
            label={t.transactions.sortNewest}
            value={sortMode}
            onChange={(val) => setSortMode(val as 'newest' | 'oldest' | 'amount')}
            options={[
              { value: 'newest', label: t.transactions.sortNewest },
              { value: 'oldest', label: t.transactions.sortOldest },
              { value: 'amount', label: t.transactions.sortAmountHigh },
            ]}
          />

          {accounts.length > 1 && (
            <GlassSelect
              label={t.transactions.accountLabel}
              value={filterAccountId}
              onChange={setFilterAccountId}
              className="col-span-2"
              options={[
                { value: '', label: `${t.transactions.accountLabel}: ${t.common.all}` },
                ...accounts.map((acc) => ({
                  value: acc.id,
                  label: `${acc.name} (${acc.currency})`,
                })),
              ]}
            />
          )}
        </div>
      </GlassCard>

      {/* Transactions List */}
      {txQuery.isLoading ? (
        <GlassCard>
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        </GlassCard>
      ) : txQuery.data && txQuery.data.transactions.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {txQuery.data.transactions.map((tx) => {
            const isCredit =
              tx.type === 'income' || tx.type === 'refund' || tx.type === 'savings_withdrawal';
            const isVoided = tx.status === 'voided';
            return (
              <GlassCard
                key={tx.id}
                padding="sm"
                onClick={() => setSelectedTxId(tx.id)}
                className="cursor-pointer hover:border-blue-400/50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                        isVoided
                          ? 'bg-slate-500/15 text-slate-400'
                          : isCredit
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-sm font-bold ${
                            isVoided
                              ? 'text-slate-400 line-through'
                              : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {tx.description ||
                            (tx.category ? localizeCategory(tx.category) : t.transactions.types[tx.type])}
                        </span>
                        {isVoided && <GlassBadge tone="amber">{t.transactions.voidedBadge}</GlassBadge>}
                        {tx.isPrivate && (
                          <GlassBadge tone="violet">
                            <EyeOff className="h-3 w-3" />
                            {t.transactions.privateBadge}
                          </GlassBadge>
                        )}
                      </div>

                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {tx.accountName} • {t.transactions.types[tx.type]} •{' '}
                        {formatDateTime(tx.occurredAt, language)}
                      </p>

                      {tx.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {tx.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-300"
                            >
                              <Tag className="h-2.5 w-2.5" />
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <p
                      className={`font-mono text-sm font-extrabold ${
                        isVoided
                          ? 'text-slate-400 line-through'
                          : isCredit
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-500'
                      }`}
                    >
                      {isCredit ? '+' : '−'}
                      {formatMoney(tx.amount, tx.currency, language)}
                    </p>
                    {tx.reportingAmount &&
                      tx.reportingCurrency &&
                      tx.reportingCurrency !== tx.currency && (
                        <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          ≈ {formatMoney(tx.reportingAmount, tx.reportingCurrency, language)}
                        </p>
                      )}
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

      {/* Transaction Detail & Ledger Trail Modal (Portal above header/dock) */}
      <GlassModal
        open={Boolean(selectedTxId)}
        onClose={() => setSelectedTxId(null)}
        title={t.transactions.detailsTitle}
        maxWidthClass="max-w-lg"
      >
        {detailQuery.isLoading ? (
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        ) : detailQuery.data ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-300/35 bg-slate-900/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{t.transactions.originalAmount}</span>
                <GlassBadge
                  tone={detailQuery.data.transaction.status === 'voided' ? 'amber' : 'emerald'}
                >
                  {detailQuery.data.transaction.status === 'voided'
                    ? t.transactions.voidedBadge
                    : t.transactions.postedBadge}
                </GlassBadge>
              </div>
              <p className="mt-1 font-mono text-2xl font-extrabold text-slate-900 dark:text-white">
                {formatMoney(
                  detailQuery.data.transaction.amount,
                  detailQuery.data.transaction.currency,
                  language,
                )}
              </p>
              {detailQuery.data.transaction.reportingAmount &&
                detailQuery.data.transaction.reportingCurrency && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t.transactions.reportingSnapshot}:{' '}
                    {formatMoney(
                      detailQuery.data.transaction.reportingAmount,
                      detailQuery.data.transaction.reportingCurrency,
                      language,
                    )}
                  </p>
                )}
              {detailQuery.data.transaction.notes && (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  {detailQuery.data.transaction.notes}
                </p>
              )}
            </div>

            {/* Immutable Ledger Entries for this transaction */}
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                {t.transactions.ledgerTrailTitle}
              </h3>
              <div className="flex flex-col gap-2">
                {detailQuery.data.ledgerEntries.map((le) => (
                  <div
                    key={le.id}
                    className="flex items-center justify-between rounded-xl border border-slate-300/35 px-3 py-2 text-xs dark:border-white/10"
                  >
                    <div>
                      <span className="font-semibold">
                        {le.direction === 'credit'
                          ? t.ledger.directionCredit
                          : t.ledger.directionDebit}
                      </span>
                      {le.isReversal && (
                        <GlassBadge tone="amber" className="ml-2">
                          {t.ledger.reversalBadge}
                        </GlassBadge>
                      )}
                      <p className="text-[11px] text-slate-500">
                        {formatDateTime(le.createdAt, language)}
                      </p>
                    </div>
                    <div className="text-right font-mono">
                      <p className="font-bold">
                        {le.signedAmount} {le.currency}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t.ledger.balanceAfter}: {le.balanceAfter}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {canWrite &&
              detailQuery.data.transaction.status === 'posted' &&
              detailQuery.data.transaction.type !== 'transfer' && (
                <div className="flex justify-end gap-2 pt-2">
                  <GlassButton
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const target = detailQuery.data!.transaction;
                      setSelectedTxId(null);
                      openEditModal(target);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t.common.edit}
                  </GlassButton>
                  <GlassButton
                    variant="danger"
                    size="sm"
                    disabled={voidMutation.isPending}
                    onClick={() => voidMutation.mutate(detailQuery.data!.transaction.id)}
                  >
                    <Ban className="h-3.5 w-3.5" />
                    {t.transactions.voidTransaction}
                  </GlassButton>
                </div>
              )}
          </div>
        ) : null}
      </GlassModal>

      {/* Create / Edit Transaction Modal (Portal with sticky action footer) */}
      <GlassModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingTx ? t.transactions.editTransaction : t.transactions.addTransaction}
        footer={
          <div className="flex items-center justify-end gap-2">
            <GlassButton variant="ghost" onClick={() => setModalOpen(false)}>
              {t.common.cancel}
            </GlassButton>
            <GlassButton type="submit" form="tx-editor-form" disabled={saveMutation.isPending}>
              {editingTx ? t.common.save : t.common.create}
            </GlassButton>
          </div>
        }
      >
        <form
          id="tx-editor-form"
          onSubmit={form.handleSubmit((vals) => saveMutation.mutate(vals))}
          className="flex flex-col gap-3"
        >
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-zinc-300">
                        {t.transactions.typeLabel}
                      </label>
                      <GlassSelect
                        label={t.transactions.typeLabel}
                        value={form.watch('type')}
                        onChange={(val) =>
                          form.setValue('type', val as (typeof POSTABLE_TYPES)[number], {
                            shouldValidate: true,
                          })
                        }
                        options={POSTABLE_TYPES.map((typeKey) => ({
                          value: typeKey,
                          label: t.transactions.types[typeKey],
                        }))}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {t.transactions.amountLabel}
                      </label>
                      <input
                        {...form.register('amount')}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="w-full rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 font-mono text-sm text-slate-900 outline-none dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
                      />
                    </div>
                  </div>

                  {watchedType === 'adjustment' && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-zinc-300">
                        {t.transactions.adjustmentDirectionLabel}
                      </label>
                      <GlassSelect
                        label={t.transactions.adjustmentDirectionLabel}
                        value={form.watch('adjustmentDirection')}
                        onChange={(val) =>
                          form.setValue('adjustmentDirection', val as 'credit' | 'debit', {
                            shouldValidate: true,
                          })
                        }
                        options={[
                          { value: 'credit', label: t.transactions.creditDirection },
                          { value: 'debit', label: t.transactions.debitDirection },
                        ]}
                      />
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-zinc-300">
                      {t.transactions.accountLabel}
                    </label>
                    <GlassSelect
                      label={t.transactions.accountLabel}
                      value={form.watch('accountId')}
                      onChange={(val) =>
                        form.setValue('accountId', val, { shouldValidate: true })
                      }
                      options={accounts.map((acc) => ({
                        value: acc.id,
                        label: `${acc.name} (${acc.currency})`,
                      }))}
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-zinc-300">
                      {t.transactions.categoryLabel}
                    </label>
                    <GlassSelect
                      label={t.transactions.categoryLabel}
                      value={form.watch('categoryId') ?? ''}
                      onChange={(val) =>
                        form.setValue('categoryId', val, { shouldValidate: true })
                      }
                      options={[
                        { value: '', label: '—' },
                        ...categories.map((cat) => ({
                          value: cat.id,
                          label: localizeCategory(cat),
                        })),
                      ]}
                    />
                  </div>

                  <GlassDateTimeInput
                    label={t.transactions.dateLabel}
                    value={form.watch('occurredAtLocal')}
                    onChange={(val) =>
                      form.setValue('occurredAtLocal', val, { shouldValidate: true })
                    }
                  />

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {t.transactions.descriptionLabel}
                    </label>
                    <input
                      {...form.register('description')}
                      className="w-full rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {t.transactions.tagsLabel}
                    </label>
                    <input
                      {...form.register('tagsText')}
                      placeholder={t.transactions.tagsPlaceholder}
                      className="w-full rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {t.transactions.notesLabel}
                    </label>
                    <textarea
                      {...form.register('notes')}
                      rows={2}
                      className="w-full rounded-xl border border-slate-300/50 bg-white/70 px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/15 dark:bg-slate-900/60 dark:text-white"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                    <input type="checkbox" {...form.register('isPrivate')} />
                    {t.transactions.privateLabel}
                  </label>

          {formError && <p className="text-xs text-rose-500">{formError}</p>}
        </form>
      </GlassModal>
    </div>
  );
}
