import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Check,
  HandCoins,
  History,
  Pause,
  Pencil,
  PiggyBank,
  Play,
  Plus,
  SkipForward,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { GlassBadge } from '@/components/glass/GlassBadge';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { GlassSelect } from '@/components/glass/GlassSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import { formatDateTime, formatMoney } from '@/i18n/formatters';
import { fetchAccounts, fetchCategories } from '@/services/financeService';
import {
  confirmRecurringExecution,
  contributeToGoal,
  createBudget,
  createDebt,
  createGoal,
  createRecurringRule,
  deleteBudget,
  fetchBudgets,
  fetchDebtHistory,
  fetchDebts,
  fetchGoalHistory,
  fetchGoals,
  fetchRecurring,
  repayDebt,
  skipRecurringExecution,
  toggleRecurringRule,
  updateBudget,
  updateDebt,
  updateGoal,
} from '@/services/planningService';
import type { BudgetItem, DebtItem, SavingsGoalItem } from '@/types/planning';
import { cn } from '@/lib/cn';

type PlanningTab = 'budgets' | 'goals' | 'debts' | 'recurring';

export function PlanningPage() {
  const { activeWorkspace } = useAuth();
  const { language, t } = useI18n();
  const queryClient = useQueryClient();

  const workspaceId = activeWorkspace?.id ?? '';
  const defaultCurrency = activeWorkspace?.defaultCurrency ?? 'UZS';
  const canWrite = activeWorkspace?.role !== 'read_only';

  const [tab, setTab] = useState<PlanningTab>('budgets');

  // Budget form state
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [budgetName, setBudgetName] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetCategoryId, setBudgetCategoryId] = useState('');
  const [budgetPeriod, setBudgetPeriod] = useState<'monthly' | 'weekly' | 'custom'>('monthly');
  const [budgetStartDate, setBudgetStartDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [budgetEndDate, setBudgetEndDate] = useState('');
  const [budgetIsShared, setBudgetIsShared] = useState(true);

  // Goal form & history state
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [goalActionAmounts, setGoalActionAmounts] = useState<Record<string, string>>({});
  const [historyGoalId, setHistoryGoalId] = useState<string | null>(null);

  // Debt form & history state
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const [debtCounterparty, setDebtCounterparty] = useState('');
  const [debtDirection, setDebtDirection] = useState<'borrowed' | 'lent'>('borrowed');
  const [debtAmount, setDebtAmount] = useState('');
  const [debtDueDate, setDebtDueDate] = useState('');
  const [debtRepayAmounts, setDebtRepayAmounts] = useState<Record<string, string>>({});
  const [historyDebtId, setHistoryDebtId] = useState<string | null>(null);

  // Recurring form state
  const [recName, setRecName] = useState('');
  const [recType, setRecType] = useState<'expense' | 'income'>('expense');
  const [recAmount, setRecAmount] = useState('');
  const [recFrequency, setRecFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>(
    'monthly',
  );
  const [recStartDate, setRecStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [recRequiresConfirm, setRecRequiresConfirm] = useState(false);

  const [selectedAccountId, setSelectedAccountId] = useState('');

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

  const budgetsQuery = useQuery({
    queryKey: ['budgets', workspaceId],
    queryFn: () => fetchBudgets(workspaceId),
    enabled: Boolean(workspaceId) && tab === 'budgets',
  });

  const goalsQuery = useQuery({
    queryKey: ['goals', workspaceId],
    queryFn: () => fetchGoals(workspaceId),
    enabled: Boolean(workspaceId) && tab === 'goals',
  });

  const goalHistoryQuery = useQuery({
    queryKey: ['goal-history', workspaceId, historyGoalId],
    queryFn: () => fetchGoalHistory(workspaceId, historyGoalId!),
    enabled: Boolean(workspaceId) && Boolean(historyGoalId),
  });

  const debtsQuery = useQuery({
    queryKey: ['debts', workspaceId],
    queryFn: () => fetchDebts(workspaceId),
    enabled: Boolean(workspaceId) && tab === 'debts',
  });

  const debtHistoryQuery = useQuery({
    queryKey: ['debt-history', workspaceId, historyDebtId],
    queryFn: () => fetchDebtHistory(workspaceId, historyDebtId!),
    enabled: Boolean(workspaceId) && Boolean(historyDebtId),
  });

  const recurringQuery = useQuery({
    queryKey: ['recurring', workspaceId],
    queryFn: () => fetchRecurring(workspaceId),
    enabled: Boolean(workspaceId) && tab === 'recurring',
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const activeAccountId = selectedAccountId || accounts[0]?.id || '';

  const invalidatePlanning = () => {
    void queryClient.invalidateQueries({ queryKey: ['budgets', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['goals', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['debts', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['recurring', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['analytics', workspaceId] });
    if (historyGoalId) {
      void queryClient.invalidateQueries({
        queryKey: ['goal-history', workspaceId, historyGoalId],
      });
    }
    if (historyDebtId) {
      void queryClient.invalidateQueries({
        queryKey: ['debt-history', workspaceId, historyDebtId],
      });
    }
  };

  const resetBudgetForm = () => {
    setEditingBudgetId(null);
    setBudgetName('');
    setBudgetLimit('');
    setBudgetCategoryId('');
    setBudgetPeriod('monthly');
    setBudgetEndDate('');
    setBudgetIsShared(true);
  };

  const saveBudgetMutation = useMutation({
    mutationFn: async () => {
      if (editingBudgetId) {
        return updateBudget(workspaceId, editingBudgetId, {
          name: budgetName,
          categoryId: budgetCategoryId || null,
          periodType: budgetPeriod,
          amountLimit: budgetLimit,
          startDate: budgetStartDate,
          endDate: budgetPeriod === 'custom' && budgetEndDate ? budgetEndDate : null,
          isShared: budgetIsShared,
        });
      }
      return createBudget(workspaceId, {
        name: budgetName,
        categoryId: budgetCategoryId || null,
        periodType: budgetPeriod,
        amountLimit: budgetLimit,
        currency: defaultCurrency,
        startDate: budgetStartDate,
        endDate: budgetPeriod === 'custom' && budgetEndDate ? budgetEndDate : null,
        isShared: budgetIsShared,
      });
    },
    onSuccess: () => {
      resetBudgetForm();
      invalidatePlanning();
    },
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: (id: string) => deleteBudget(workspaceId, id),
    onSuccess: invalidatePlanning,
  });

  const startEditBudget = (b: BudgetItem) => {
    setEditingBudgetId(b.id);
    setBudgetName(b.name);
    setBudgetLimit(b.amountLimit);
    setBudgetCategoryId(b.categoryId ?? '');
    setBudgetPeriod(b.periodType);
    setBudgetStartDate(b.startDate);
    setBudgetEndDate(b.endDate ?? '');
    setBudgetIsShared(b.isShared);
  };

  const resetGoalForm = () => {
    setEditingGoalId(null);
    setGoalName('');
    setGoalTarget('');
    setGoalDeadline('');
  };

  const saveGoalMutation = useMutation({
    mutationFn: async () => {
      if (editingGoalId) {
        return updateGoal(workspaceId, editingGoalId, {
          name: goalName,
          targetAmount: goalTarget,
          deadline: goalDeadline || null,
        });
      }
      return createGoal(workspaceId, {
        name: goalName,
        targetAmount: goalTarget,
        currency: defaultCurrency,
        deadline: goalDeadline || null,
        isShared: true,
      });
    },
    onSuccess: () => {
      resetGoalForm();
      invalidatePlanning();
    },
  });

  const startEditGoal = (g: SavingsGoalItem) => {
    setEditingGoalId(g.id);
    setGoalName(g.name);
    setGoalTarget(g.targetAmount);
    setGoalDeadline(g.deadline ?? '');
  };

  const contributeGoalMutation = useMutation({
    mutationFn: ({
      goalId,
      direction,
    }: {
      goalId: string;
      direction: 'deposit' | 'withdrawal';
    }) =>
      contributeToGoal(workspaceId, goalId, {
        accountId: activeAccountId,
        amount: goalActionAmounts[goalId] || '0',
        direction,
      }),
    onSuccess: () => {
      setGoalActionAmounts({});
      invalidatePlanning();
    },
  });

  const resetDebtForm = () => {
    setEditingDebtId(null);
    setDebtCounterparty('');
    setDebtAmount('');
    setDebtDueDate('');
  };

  const saveDebtMutation = useMutation({
    mutationFn: async () => {
      if (editingDebtId) {
        return updateDebt(workspaceId, editingDebtId, {
          counterpartyName: debtCounterparty,
          dueDate: debtDueDate || null,
        });
      }
      return createDebt(workspaceId, {
        counterpartyName: debtCounterparty,
        direction: debtDirection,
        principalAmount: debtAmount,
        currency: defaultCurrency,
        dueDate: debtDueDate || null,
        isPrivate: false,
      });
    },
    onSuccess: () => {
      resetDebtForm();
      invalidatePlanning();
    },
  });

  const startEditDebt = (d: DebtItem) => {
    setEditingDebtId(d.id);
    setDebtCounterparty(d.counterpartyName);
    setDebtDirection(d.direction);
    setDebtAmount(d.principalAmount);
    setDebtDueDate(d.dueDate ?? '');
  };

  const repayDebtMutation = useMutation({
    mutationFn: ({ debtId, amount }: { debtId: string; amount: string }) =>
      repayDebt(workspaceId, debtId, {
        accountId: activeAccountId,
        amount,
      }),
    onSuccess: () => {
      setDebtRepayAmounts({});
      invalidatePlanning();
    },
  });

  const createRecurringMutation = useMutation({
    mutationFn: () =>
      createRecurringRule(workspaceId, {
        name: recName,
        accountId: activeAccountId,
        type: recType,
        amount: recAmount,
        frequency: recFrequency,
        startDate: recStartDate,
        requiresConfirmation: recRequiresConfirm,
      }),
    onSuccess: () => {
      setRecName('');
      setRecAmount('');
      invalidatePlanning();
    },
  });

  const confirmRecMutation = useMutation({
    mutationFn: (execId: string) => confirmRecurringExecution(workspaceId, execId),
    onSuccess: invalidatePlanning,
  });

  const skipRecMutation = useMutation({
    mutationFn: (execId: string) => skipRecurringExecution(workspaceId, execId),
    onSuccess: invalidatePlanning,
  });

  const toggleRecMutation = useMutation({
    mutationFn: (ruleId: string) => toggleRecurringRule(workspaceId, ruleId),
    onSuccess: invalidatePlanning,
  });

  const TABS: Array<{ key: PlanningTab; label: string; icon: typeof Target }> = [
    { key: 'budgets', label: t.planning.tabs.budgets, icon: Target },
    { key: 'goals', label: t.planning.tabs.goals, icon: PiggyBank },
    { key: 'debts', label: t.planning.tabs.debts, icon: HandCoins },
    { key: 'recurring', label: t.planning.tabs.recurring, icon: CalendarClock },
  ];

  const GOAL_PRESETS = [
    t.planning.goals.presets.car,
    t.planning.goals.presets.house,
    t.planning.goals.presets.travel,
    t.planning.goals.presets.emergency,
  ];

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
            {t.planning.title}
          </h1>
          <p className="text-xs text-slate-600 dark:text-zinc-400 sm:text-sm">
            {t.planning.subtitle}
          </p>
        </div>

        <div className="liquid-glass-pill no-scrollbar flex w-full flex-nowrap items-center gap-1 overflow-x-auto rounded-full p-1 sm:w-fit">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                tab === key
                  ? 'liquid-glass-lens text-white dark:text-slate-950'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Account Selector for Goal Contributions / Debt Repayments / Recurring */}
      {accounts.length > 0 && tab !== 'budgets' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-600 dark:text-zinc-300">
            {t.transactions.accountLabel}:
          </span>
          <GlassSelect
            label={t.transactions.accountLabel}
            value={activeAccountId}
            onChange={setSelectedAccountId}
            className="w-full sm:w-64"
            options={accounts.map((acc) => ({
              value: acc.id,
              label: `${acc.name} (${acc.currentBalance} ${acc.currency})`,
            }))}
          />
        </div>
      )}

      {/* TAB 1: BUDGETS */}
      {tab === 'budgets' && (
        <>
          {canWrite && (
            <GlassCard>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {editingBudgetId
                    ? t.planning.budgets.editBudget
                    : t.planning.budgets.addBudget}
                </h2>
                {editingBudgetId && (
                  <GlassButton variant="ghost" size="sm" onClick={resetBudgetForm}>
                    {t.common.cancel}
                  </GlassButton>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <input
                  value={budgetName}
                  onChange={(e) => setBudgetName(e.target.value)}
                  placeholder={t.accounts.nameLabel}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
                />
                <input
                  value={budgetLimit}
                  onChange={(e) => setBudgetLimit(e.target.value)}
                  inputMode="decimal"
                  placeholder={`${t.planning.budgets.limitLabel} (${defaultCurrency})`}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 font-mono text-xs dark:border-white/15 dark:bg-slate-900/60"
                />
                <GlassSelect
                  label={t.transactions.categoryLabel}
                  value={budgetCategoryId}
                  onChange={setBudgetCategoryId}
                  options={[
                    { value: '', label: t.common.all },
                    ...(categoriesQuery.data?.categories ?? []).map((c) => ({
                      value: c.id,
                      label: c.name,
                    })),
                  ]}
                />
                <GlassSelect
                  label={t.planning.tabs.budgets}
                  value={budgetPeriod}
                  onChange={(val) =>
                    setBudgetPeriod(val as 'monthly' | 'weekly' | 'custom')
                  }
                  options={[
                    { value: 'monthly', label: t.planning.budgets.periodMonthly },
                    { value: 'weekly', label: t.planning.budgets.periodWeekly },
                    { value: 'custom', label: t.planning.budgets.periodCustom },
                  ]}
                />
              </div>

              {budgetPeriod === 'custom' && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    value={budgetStartDate}
                    onChange={(e) => setBudgetStartDate(e.target.value)}
                    className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
                  />
                  <input
                    type="date"
                    value={budgetEndDate}
                    onChange={(e) => setBudgetEndDate(e.target.value)}
                    className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
                  />
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={budgetIsShared}
                    onChange={(e) => setBudgetIsShared(e.target.checked)}
                  />
                  {t.planning.budgets.sharedLabel}
                </label>

                <GlassButton
                  size="sm"
                  disabled={!budgetName || !budgetLimit || saveBudgetMutation.isPending}
                  onClick={() => saveBudgetMutation.mutate()}
                >
                  <Plus className="h-4 w-4" />
                  {editingBudgetId ? t.common.save : t.common.create}
                </GlassButton>
              </div>
            </GlassCard>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {(budgetsQuery.data?.budgets ?? []).map((b) => (
              <GlassCard key={b.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{b.name}</h3>
                    <p className="text-xs text-slate-500">
                      {b.periodType === 'weekly'
                        ? t.planning.budgets.periodWeekly
                        : b.periodType === 'custom'
                          ? `${b.startDate} → ${b.endDate ?? ''}`
                          : t.planning.budgets.periodMonthly}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <GlassBadge
                      tone={
                        b.usagePct >= 100
                          ? 'amber'
                          : b.usagePct >= 75
                            ? 'violet'
                            : 'blue'
                      }
                    >
                      {b.usagePct}%
                    </GlassBadge>
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditBudget(b)}
                          className="rounded-lg p-1 text-slate-400 hover:text-blue-500"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteBudgetMutation.mutate(b.id)}
                          className="rounded-lg p-1 text-slate-400 hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Progress bar with 50% / 75% / 90% / 100% threshold markers */}
                <div className="relative mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      b.usagePct >= 100
                        ? 'bg-rose-500'
                        : b.usagePct >= 75
                          ? 'bg-amber-500'
                          : 'bg-emerald-500',
                    )}
                    style={{ width: `${Math.min(100, b.usagePct)}%` }}
                  />
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  <div>
                    <span className="block text-[10px] text-slate-400">
                      {t.planning.budgets.spentLabel}
                    </span>
                    {formatMoney(b.spentAmount, b.currency, language)}
                  </div>
                  <div>
                    <span className="block text-[10px] text-slate-400">
                      {t.planning.budgets.remainingLabel}
                    </span>
                    {formatMoney(b.remainingAmount, b.currency, language)}
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] text-slate-400">
                      {t.planning.budgets.limitLabel}
                    </span>
                    {formatMoney(b.amountLimit, b.currency, language)}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {/* TAB 2: SAVINGS GOALS */}
      {tab === 'goals' && (
        <>
          {canWrite && (
            <GlassCard>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {editingGoalId ? t.planning.goals.editGoal : t.planning.goals.addGoal}
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {GOAL_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setGoalName(preset)}
                      className="rounded-full border border-slate-300/40 px-2.5 py-0.5 text-[11px] font-medium hover:border-blue-500 dark:border-white/15"
                    >
                      + {preset}
                    </button>
                  ))}
                  {editingGoalId && (
                    <GlassButton variant="ghost" size="sm" onClick={resetGoalForm}>
                      {t.common.cancel}
                    </GlassButton>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <input
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  placeholder={t.accounts.nameLabel}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
                />
                <input
                  value={goalTarget}
                  onChange={(e) => setGoalTarget(e.target.value)}
                  inputMode="decimal"
                  placeholder={`${t.planning.goals.targetLabel} (${defaultCurrency})`}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 font-mono text-xs dark:border-white/15 dark:bg-slate-900/60"
                />
                <input
                  type="date"
                  value={goalDeadline}
                  onChange={(e) => setGoalDeadline(e.target.value)}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
                />
                <GlassButton
                  size="sm"
                  disabled={!goalName || !goalTarget || saveGoalMutation.isPending}
                  onClick={() => saveGoalMutation.mutate()}
                >
                  <Plus className="h-4 w-4" />
                  {editingGoalId ? t.common.save : t.common.create}
                </GlassButton>
              </div>
            </GlassCard>
          )}

          {historyGoalId && (
            <GlassCard>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t.planning.goals.historyTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setHistoryGoalId(null)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {goalHistoryQuery.isLoading ? (
                <p className="text-xs text-slate-500">{t.common.loading}</p>
              ) : (goalHistoryQuery.data?.history ?? []).length === 0 ? (
                <p className="text-xs text-slate-500">{t.common.noData}</p>
              ) : (
                <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                  {(goalHistoryQuery.data?.history ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-xl border border-slate-300/30 px-3 py-2 text-xs dark:border-white/10"
                    >
                      <div>
                        <span className="font-bold">
                          {item.direction === 'deposit'
                            ? t.planning.goals.deposit
                            : t.planning.goals.withdraw}
                        </span>{' '}
                        • {item.accountName}
                        <p className="text-[10px] text-slate-400">
                          {formatDateTime(item.occurredAt, language)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'font-mono font-bold',
                          item.direction === 'deposit' ? 'text-emerald-500' : 'text-rose-500',
                        )}
                      >
                        {item.direction === 'deposit' ? '+' : '−'}
                        {formatMoney(item.amount, item.currency, language)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {(goalsQuery.data?.goals ?? []).map((g) => (
              <GlassCard key={g.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{g.name}</h3>
                    {g.deadline && (
                      <p className="text-[11px] text-slate-500">
                        {t.planning.goals.deadlineLabel}: {g.deadline}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <GlassBadge tone={g.status === 'completed' ? 'emerald' : 'blue'}>
                      {g.progressPct}%
                    </GlassBadge>
                    <button
                      type="button"
                      onClick={() => setHistoryGoalId(g.id)}
                      title={t.planning.goals.historyTitle}
                      className="rounded-lg p-1 text-slate-400 hover:text-blue-500"
                    >
                      <History className="h-3.5 w-3.5" />
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => startEditGoal(g)}
                        className="rounded-lg p-1 text-slate-400 hover:text-blue-500"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-blue-500"
                    style={{ width: `${g.progressPct}%` }}
                  />
                </div>

                <div className="mt-2 flex justify-between font-mono text-xs">
                  <span>{formatMoney(g.currentAmount, g.currency, language)}</span>
                  <span className="text-slate-500">
                    {formatMoney(g.targetAmount, g.currency, language)}
                  </span>
                </div>

                {canWrite && activeAccountId && (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={goalActionAmounts[g.id] ?? ''}
                      onChange={(e) =>
                        setGoalActionAmounts((p) => ({ ...p, [g.id]: e.target.value }))
                      }
                      inputMode="decimal"
                      placeholder={t.transactions.amountLabel}
                      className="w-full rounded-xl border border-slate-300/40 bg-white/70 px-2.5 py-1.5 font-mono text-xs dark:border-white/15 dark:bg-slate-900/60"
                    />
                    <GlassButton
                      size="sm"
                      onClick={() =>
                        contributeGoalMutation.mutate({ goalId: g.id, direction: 'deposit' })
                      }
                    >
                      {t.planning.goals.deposit}
                    </GlassButton>
                    <GlassButton
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        contributeGoalMutation.mutate({ goalId: g.id, direction: 'withdrawal' })
                      }
                    >
                      {t.planning.goals.withdraw}
                    </GlassButton>
                  </div>
                )}
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {/* TAB 3: DEBTS */}
      {tab === 'debts' && (
        <>
          {canWrite && (
            <GlassCard>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {editingDebtId ? t.planning.debts.editDebt : t.planning.debts.addDebt}
                </h2>
                {editingDebtId && (
                  <GlassButton variant="ghost" size="sm" onClick={resetDebtForm}>
                    {t.common.cancel}
                  </GlassButton>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-5">
                <input
                  value={debtCounterparty}
                  onChange={(e) => setDebtCounterparty(e.target.value)}
                  placeholder={t.planning.debts.counterparty}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
                />
                <GlassSelect
                  label={t.planning.tabs.debts}
                  value={debtDirection}
                  disabled={Boolean(editingDebtId)}
                  onChange={(val) => setDebtDirection(val as 'borrowed' | 'lent')}
                  options={[
                    { value: 'borrowed', label: t.planning.debts.borrowed },
                    { value: 'lent', label: t.planning.debts.lent },
                  ]}
                />
                <input
                  value={debtAmount}
                  disabled={Boolean(editingDebtId)}
                  onChange={(e) => setDebtAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder={`${t.transactions.amountLabel} (${defaultCurrency})`}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 font-mono text-xs disabled:opacity-60 dark:border-white/15 dark:bg-slate-900/60"
                />
                <input
                  type="date"
                  value={debtDueDate}
                  onChange={(e) => setDebtDueDate(e.target.value)}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
                />
                <GlassButton
                  size="sm"
                  disabled={!debtCounterparty || (!editingDebtId && !debtAmount) || saveDebtMutation.isPending}
                  onClick={() => saveDebtMutation.mutate()}
                >
                  <Plus className="h-4 w-4" />
                  {editingDebtId ? t.common.save : t.common.create}
                </GlassButton>
              </div>
            </GlassCard>
          )}

          {historyDebtId && (
            <GlassCard>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t.planning.debts.historyTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setHistoryDebtId(null)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {debtHistoryQuery.isLoading ? (
                <p className="text-xs text-slate-500">{t.common.loading}</p>
              ) : (debtHistoryQuery.data?.history ?? []).length === 0 ? (
                <p className="text-xs text-slate-500">{t.common.noData}</p>
              ) : (
                <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                  {(debtHistoryQuery.data?.history ?? []).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-xl border border-slate-300/30 px-3 py-2 text-xs dark:border-white/10"
                    >
                      <div>
                        <span className="font-bold">{item.accountName}</span>
                        <p className="text-[10px] text-slate-400">
                          {formatDateTime(item.paidAt, language)}
                        </p>
                      </div>
                      <span className="font-mono font-bold text-emerald-500">
                        {formatMoney(item.amount, item.currency, language)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {(debtsQuery.data?.debts ?? []).map((d) => (
              <GlassCard key={d.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {d.counterpartyName}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {d.direction === 'borrowed'
                        ? t.planning.debts.borrowed
                        : t.planning.debts.lent}
                      {d.dueDate ? ` • ${d.dueDate}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <GlassBadge
                      tone={
                        d.status === 'paid'
                          ? 'emerald'
                          : d.status === 'overdue'
                            ? 'amber'
                            : 'violet'
                      }
                    >
                      {d.status === 'paid'
                        ? t.planning.debts.paidBadge
                        : d.status === 'overdue'
                          ? t.planning.debts.overdueBadge
                          : d.status}
                    </GlassBadge>
                    <button
                      type="button"
                      onClick={() => setHistoryDebtId(d.id)}
                      title={t.planning.debts.historyTitle}
                      className="rounded-lg p-1 text-slate-400 hover:text-blue-500"
                    >
                      <History className="h-3.5 w-3.5" />
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => startEditDebt(d)}
                        className="rounded-lg p-1 text-slate-400 hover:text-blue-500"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-3 font-mono text-lg font-extrabold text-slate-900 dark:text-white">
                  {t.planning.debts.remaining}:{' '}
                  {formatMoney(d.remainingAmount, d.currency, language)}
                </p>

                {canWrite && activeAccountId && d.status !== 'paid' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input
                      value={debtRepayAmounts[d.id] ?? ''}
                      onChange={(e) =>
                        setDebtRepayAmounts((p) => ({ ...p, [d.id]: e.target.value }))
                      }
                      inputMode="decimal"
                      placeholder={t.transactions.amountLabel}
                      className="flex-1 rounded-xl border border-slate-300/40 bg-white/70 px-2.5 py-1.5 font-mono text-xs dark:border-white/15 dark:bg-slate-900/60"
                    />
                    <GlassButton
                      size="sm"
                      onClick={() =>
                        repayDebtMutation.mutate({
                          debtId: d.id,
                          amount: debtRepayAmounts[d.id] || '0',
                        })
                      }
                    >
                      {t.planning.debts.repay}
                    </GlassButton>
                    <GlassButton
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        repayDebtMutation.mutate({
                          debtId: d.id,
                          amount: d.remainingAmount,
                        })
                      }
                    >
                      {t.planning.debts.payFull}
                    </GlassButton>
                  </div>
                )}
              </GlassCard>
            ))}
          </div>
        </>
      )}

      {/* TAB 4: RECURRING PAYMENTS */}
      {tab === 'recurring' && (
        <>
          {(recurringQuery.data?.pendingConfirmations ?? []).length > 0 && (
            <GlassCard>
              <h2 className="mb-3 text-sm font-bold text-amber-500">
                {t.planning.recurring.pendingTitle}
              </h2>
              <div className="flex flex-col gap-2">
                {(recurringQuery.data?.pendingConfirmations ?? []).map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs"
                  >
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">
                        {item.rule?.name ?? item.rule_id}
                      </p>
                      <p className="text-slate-500">
                        {item.scheduled_for} •{' '}
                        {item.rule
                          ? formatMoney(item.rule.amount, item.rule.currency, language)
                          : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <GlassButton size="sm" onClick={() => confirmRecMutation.mutate(item.id)}>
                        <Check className="h-3.5 w-3.5" />
                        {t.planning.recurring.confirmRun}
                      </GlassButton>
                      <GlassButton
                        variant="secondary"
                        size="sm"
                        onClick={() => skipRecMutation.mutate(item.id)}
                      >
                        <SkipForward className="h-3.5 w-3.5" />
                        {t.planning.recurring.skipRun}
                      </GlassButton>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {canWrite && activeAccountId && (
            <GlassCard>
              <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
                {t.planning.recurring.addRule}
              </h2>
              <div className="grid gap-3 sm:grid-cols-5">
                <input
                  value={recName}
                  onChange={(e) => setRecName(e.target.value)}
                  placeholder={t.accounts.nameLabel}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
                />
                <GlassSelect
                  label={t.transactions.typeLabel}
                  value={recType}
                  onChange={(val) => setRecType(val as 'expense' | 'income')}
                  options={[
                    { value: 'expense', label: t.transactions.types.expense },
                    { value: 'income', label: t.transactions.types.income },
                  ]}
                />
                <input
                  value={recAmount}
                  onChange={(e) => setRecAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder={t.transactions.amountLabel}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 font-mono text-xs dark:border-white/15 dark:bg-slate-900/60"
                />
                <GlassSelect
                  label={t.planning.recurring.frequency}
                  value={recFrequency}
                  onChange={(val) =>
                    setRecFrequency(val as 'daily' | 'weekly' | 'monthly' | 'yearly')
                  }
                  options={[
                    { value: 'daily', label: t.reports.types.daily },
                    { value: 'weekly', label: t.reports.types.weekly },
                    { value: 'monthly', label: t.reports.types.monthly },
                    { value: 'yearly', label: t.reports.types.yearly },
                  ]}
                />
                <input
                  type="date"
                  value={recStartDate}
                  onChange={(e) => setRecStartDate(e.target.value)}
                  className="rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={recRequiresConfirm}
                    onChange={(e) => setRecRequiresConfirm(e.target.checked)}
                  />
                  {t.planning.recurring.requiresConfirm}
                </label>
                <GlassButton
                  size="sm"
                  disabled={!recName || !recAmount || createRecurringMutation.isPending}
                  onClick={() => createRecurringMutation.mutate()}
                >
                  <Plus className="h-4 w-4" />
                  {t.common.create}
                </GlassButton>
              </div>
            </GlassCard>
          )}

          <div className="flex flex-col gap-2.5">
            {(recurringQuery.data?.rules ?? []).map((rule) => (
              <GlassCard key={rule.id} padding="sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{rule.name}</p>
                    <p className="text-xs text-slate-500">
                      {rule.frequency} • {t.planning.recurring.nextRun}: {rule.next_run_date}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold">
                      {formatMoney(rule.amount, rule.currency, language)}
                    </span>
                    {canWrite && (
                      <GlassButton
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleRecMutation.mutate(rule.id)}
                      >
                        {rule.is_active ? (
                          <>
                            <Pause className="h-3.5 w-3.5" />
                            {t.planning.recurring.pause}
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5" />
                            {t.planning.recurring.resume}
                          </>
                        )}
                      </GlassButton>
                    )}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
