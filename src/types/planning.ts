export type AnalyticsPeriod = 'today' | 'week' | 'month' | 'last_month' | 'year' | 'custom';

export type ReportType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'category'
  | 'account'
  | 'family';

export interface AnalyticsResponse {
  workspaceId: string;
  reportingCurrency: string;
  period: {
    type: AnalyticsPeriod;
    from: string;
    to: string;
  };
  kpis: {
    totalBalance: string;
    netWorth: string;
    savingsTotal: string;
    budgetUsagePct: number;
    pendingRecurringCount: number;
    totalIncome: string;
    totalExpenses: string;
    netCashFlow: string;
    savingsContributionNet: string;
    savingsRate: number;
    averageDailyExpenses: string;
    monthlyGrowthPct: number;
    highestSpendingCategory: {
      categoryId: string;
      name: string;
      color: string;
      txCount?: number;
      amount: number;
      amountFormatted: string;
      sharePct: number;
    } | null;
  };
  charts: {
    incomeVsExpenses: Array<{ label: string; income: number; expense: number }>;
    dailySpending: Array<{ date: string; income: number; expense: number }>;
    monthlyCashFlow: Array<{ month: string; income: number; expense: number; net: number }>;
    categoryBreakdown: Array<{
      categoryId: string;
      name: string;
      color: string;
      txCount?: number;
      amount: number;
      amountFormatted: string;
      sharePct: number;
    }>;
    monthlyComparisons: Array<{
      categoryId: string;
      name: string;
      color: string;
      currentExpense: number;
      previousExpense: number;
      changePct: number;
    }>;
    savingsGrowth: Array<{
      month: string;
      monthlySaved: number;
      cumulativeSavings: number;
    }>;
    accountDistribution: Array<{
      accountId: string;
      name: string;
      currency: string;
      nativeBalance: string;
      convertedBalance: number;
      color: string;
    }>;
    budgetUsage: Array<{
      id: string;
      name: string;
      currency: string;
      limit: number;
      spent: number;
      usagePct: number;
    }>;
    netWorthHistory: Array<{ month: string; netWorth: number }>;
  };
  recentTransactions: Array<{
    id: string;
    accountId: string;
    accountName: string;
    type: string;
    status: string;
    amount: string;
    currency: string;
    description: string | null;
    occurredAt: string;
  }>;
  upcomingPayments: Array<{
    id: string;
    name: string;
    type: string;
    amount: string;
    currency: string;
    frequency: string;
    next_run_date: string;
  }>;
  activeGoals: Array<{
    id: string;
    name: string;
    targetAmount: string;
    currentAmount: string;
    currency: string;
    deadline: string | null;
    color: string;
    progressPct: number;
  }>;
}

export interface BudgetItem {
  id: string;
  name: string;
  categoryId: string | null;
  category?: { id: string; name: string; color?: string } | null;
  periodType: 'weekly' | 'monthly' | 'custom';
  amountLimit: string;
  spentAmount: string;
  remainingAmount: string;
  usagePct: number;
  currency: string;
  startDate: string;
  endDate: string | null;
  isShared: boolean;
}

export interface SavingsGoalItem {
  id: string;
  name: string;
  description: string | null;
  targetAmount: string;
  currentAmount: string;
  remainingAmount?: string;
  currency: string;
  deadline: string | null;
  color: string;
  status: 'active' | 'completed' | 'paused' | 'cancelled';
  isShared: boolean;
  progressPct: number;
}

export interface GoalContributionHistoryItem {
  id: string;
  amount: string;
  currency: string;
  direction: 'deposit' | 'withdrawal';
  accountName: string;
  notes: string | null;
  occurredAt: string;
}

export interface DebtItem {
  id: string;
  counterpartyName: string;
  counterpartyContact: string | null;
  direction: 'borrowed' | 'lent';
  principalAmount: string;
  remainingAmount: string;
  paidAmount?: string;
  paidPct?: number;
  currency: string;
  issuedDate: string;
  dueDate: string | null;
  status: 'open' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
  notes: string | null;
  isPrivate: boolean;
}

export interface DebtPaymentHistoryItem {
  id: string;
  amount: string;
  currency: string;
  accountName: string;
  paidAt: string;
  notes: string | null;
}

export interface RecurringRuleItem {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  account_id: string;
  amount: string;
  currency: string;
  frequency: string;
  next_run_date: string;
  requires_confirmation: boolean;
  is_active: boolean;
}

export interface PendingRecurringExecution {
  id: string;
  rule_id: string;
  scheduled_for: string;
  status: string;
  rule: {
    id: string;
    name: string;
    type: string;
    amount: string;
    currency: string;
  } | null;
}

export interface WorkspaceMemberItem {
  memberId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'read_only';
  joinedAt: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  delivery_status: string;
  read_at: string | null;
  created_at: string;
}

export interface TimeReportRow {
  periodKey: string;
  income: string;
  expense: string;
  netCashFlow: string;
  txCount: number;
}

export interface AccountReportRow {
  accountId: string;
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
  totalInflow: string;
  totalOutflow: string;
  closingBalance: string;
  convertedClosingBalance: string;
  txCount: number;
}

export interface FamilyReportRow {
  userId: string;
  memberName: string;
  role: string;
  income: string;
  expense: string;
  netContribution: string;
  txCount: number;
}

export interface ReportsSummaryResponse {
  workspaceName: string;
  workspaceType: string;
  reportingCurrency: string;
  reportType: ReportType;
  period: AnalyticsPeriod;
  from: string;
  to: string;
  transactionCount: number;
  metrics: AnalyticsResponse['kpis'];
  reports: {
    daily: TimeReportRow[];
    weekly: TimeReportRow[];
    monthly: TimeReportRow[];
    yearly: TimeReportRow[];
    category: AnalyticsResponse['charts']['categoryBreakdown'];
    account: AccountReportRow[];
    family: FamilyReportRow[];
  };
}
