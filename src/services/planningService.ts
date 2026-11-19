import { apiRequest, downloadApiFile } from '@/lib/apiClient';
import type {
  AnalyticsPeriod,
  AnalyticsResponse,
  BudgetItem,
  DebtItem,
  DebtPaymentHistoryItem,
  GoalContributionHistoryItem,
  NotificationItem,
  PendingRecurringExecution,
  RecurringRuleItem,
  ReportType,
  ReportsSummaryResponse,
  SavingsGoalItem,
  WorkspaceMemberItem,
} from '@/types/planning';

export async function fetchAnalytics(
  workspaceId: string,
  period: AnalyticsPeriod = 'month',
  options: { from?: string; to?: string; reportingCurrency?: string } = {},
): Promise<AnalyticsResponse> {
  const params = new URLSearchParams({ period });
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  if (options.reportingCurrency) params.set('reportingCurrency', options.reportingCurrency);
  return apiRequest(`/api/analytics?${params.toString()}`, { workspaceId });
}

export async function fetchBudgets(workspaceId: string): Promise<{ budgets: BudgetItem[] }> {
  return apiRequest('/api/budgets', { workspaceId });
}

export async function createBudget(
  workspaceId: string,
  payload: {
    name: string;
    categoryId?: string | null;
    periodType: 'weekly' | 'monthly' | 'custom';
    amountLimit: string;
    currency: string;
    startDate?: string;
    endDate?: string | null;
    isShared: boolean;
  },
) {
  return apiRequest('/api/budgets', { method: 'POST', workspaceId, body: payload });
}

export async function updateBudget(
  workspaceId: string,
  budgetId: string,
  payload: Partial<{
    name: string;
    categoryId: string | null;
    periodType: 'weekly' | 'monthly' | 'custom';
    amountLimit: string;
    startDate: string;
    endDate: string | null;
    isShared: boolean;
  }>,
) {
  return apiRequest(`/api/budgets/${budgetId}`, {
    method: 'PATCH',
    workspaceId,
    body: payload,
  });
}

export async function deleteBudget(workspaceId: string, id: string) {
  return apiRequest(`/api/budgets/${id}`, { method: 'DELETE', workspaceId });
}

export async function fetchGoals(workspaceId: string): Promise<{ goals: SavingsGoalItem[] }> {
  return apiRequest('/api/goals', { workspaceId });
}

export async function createGoal(
  workspaceId: string,
  payload: {
    name: string;
    description?: string | null;
    targetAmount: string;
    currency: string;
    deadline?: string | null;
    isShared: boolean;
  },
) {
  return apiRequest('/api/goals', { method: 'POST', workspaceId, body: payload });
}

export async function updateGoal(
  workspaceId: string,
  goalId: string,
  payload: Partial<{
    name: string;
    description: string | null;
    targetAmount: string;
    deadline: string | null;
    status: 'active' | 'completed' | 'paused' | 'cancelled';
    isShared: boolean;
  }>,
) {
  return apiRequest(`/api/goals/${goalId}`, {
    method: 'PATCH',
    workspaceId,
    body: payload,
  });
}

export async function fetchGoalHistory(
  workspaceId: string,
  goalId: string,
): Promise<{ history: GoalContributionHistoryItem[] }> {
  return apiRequest(`/api/goals/${goalId}/history`, { workspaceId });
}

export async function contributeToGoal(
  workspaceId: string,
  goalId: string,
  payload: { accountId: string; amount: string; direction: 'deposit' | 'withdrawal'; notes?: string },
) {
  return apiRequest(`/api/goals/${goalId}/contribute`, {
    method: 'POST',
    workspaceId,
    body: payload,
  });
}

export async function fetchDebts(workspaceId: string): Promise<{ debts: DebtItem[] }> {
  return apiRequest('/api/debts', { workspaceId });
}

export async function createDebt(
  workspaceId: string,
  payload: {
    counterpartyName: string;
    counterpartyContact?: string | null;
    direction: 'borrowed' | 'lent';
    principalAmount: string;
    currency: string;
    dueDate?: string | null;
    notes?: string | null;
    isPrivate: boolean;
  },
) {
  return apiRequest('/api/debts', { method: 'POST', workspaceId, body: payload });
}

export async function updateDebt(
  workspaceId: string,
  debtId: string,
  payload: Partial<{
    counterpartyName: string;
    counterpartyContact: string | null;
    dueDate: string | null;
    notes: string | null;
    isPrivate: boolean;
  }>,
) {
  return apiRequest(`/api/debts/${debtId}`, {
    method: 'PATCH',
    workspaceId,
    body: payload,
  });
}

export async function fetchDebtHistory(
  workspaceId: string,
  debtId: string,
): Promise<{ history: DebtPaymentHistoryItem[] }> {
  return apiRequest(`/api/debts/${debtId}/history`, { workspaceId });
}

export async function repayDebt(
  workspaceId: string,
  debtId: string,
  payload: { accountId: string; amount: string; notes?: string },
) {
  return apiRequest(`/api/debts/${debtId}/repay`, {
    method: 'POST',
    workspaceId,
    body: payload,
  });
}

export async function fetchRecurring(workspaceId: string): Promise<{
  rules: RecurringRuleItem[];
  pendingConfirmations: PendingRecurringExecution[];
}> {
  return apiRequest('/api/recurring', { workspaceId });
}

export async function createRecurringRule(
  workspaceId: string,
  payload: {
    name: string;
    accountId: string;
    type: 'income' | 'expense';
    amount: string;
    frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
    startDate: string;
    requiresConfirmation: boolean;
  },
) {
  return apiRequest('/api/recurring', { method: 'POST', workspaceId, body: payload });
}

export async function confirmRecurringExecution(workspaceId: string, executionId: string) {
  return apiRequest(`/api/recurring/${executionId}/confirm`, { method: 'POST', workspaceId });
}

export async function skipRecurringExecution(workspaceId: string, executionId: string) {
  return apiRequest(`/api/recurring/${executionId}/skip`, { method: 'POST', workspaceId });
}

export async function toggleRecurringRule(workspaceId: string, ruleId: string) {
  return apiRequest(`/api/recurring/${ruleId}/toggle`, { method: 'POST', workspaceId });
}

export async function fetchReportsSummary(
  workspaceId: string,
  reportType: ReportType,
  period: AnalyticsPeriod,
  options: { from?: string; to?: string } = {},
): Promise<ReportsSummaryResponse> {
  const params = new URLSearchParams({ reportType, period });
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  return apiRequest(`/api/reports/summary?${params.toString()}`, { workspaceId });
}

export function buildReportExportUrl(params: {
  reportType: ReportType;
  period: AnalyticsPeriod;
  format: 'csv' | 'xlsx' | 'pdf';
  from?: string;
  to?: string;
}): string {
  const qs = new URLSearchParams({
    reportType: params.reportType,
    period: params.period,
    format: params.format,
  });
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  return `/api/reports/export?${qs.toString()}`;
}

export async function downloadReportExport(
  workspaceId: string,
  params: {
    reportType: ReportType;
    period: AnalyticsPeriod;
    format: 'csv' | 'xlsx' | 'pdf';
    from?: string;
    to?: string;
  },
): Promise<void> {
  const url = buildReportExportUrl(params);
  await downloadApiFile(url, {
    workspaceId,
    fallbackFileName: `finora-${params.reportType}-${params.period}.${params.format}`,
  });
}

export async function createFamilyWorkspace(payload: { name: string; defaultCurrency: string }) {
  return apiRequest<{
    workspace: {
      id: string;
      name: string;
      type: 'family';
      role: 'owner';
      defaultCurrency: string;
    };
  }>('/api/workspaces', { method: 'POST', body: payload });
}

export async function fetchWorkspaceMembers(workspaceId: string): Promise<{
  members: WorkspaceMemberItem[];
  invitations: Array<{
    id: string;
    role: string;
    expires_at: string;
    use_count: number;
    max_uses: number;
  }>;
}> {
  return apiRequest('/api/workspaces/members', { workspaceId });
}

export async function createWorkspaceInvite(
  workspaceId: string,
  payload: { role: 'admin' | 'member' | 'read_only'; inviteeUsername?: string },
): Promise<{ inviteToken: string; expiresAt: string }> {
  return apiRequest('/api/workspaces/invitations', {
    method: 'POST',
    workspaceId,
    body: payload,
  });
}

export async function acceptWorkspaceInvite(token: string) {
  return apiRequest<{ joinedWorkspaceId: string; role: string }>(
    '/api/workspaces/invitations/accept',
    { method: 'POST', body: { token } },
  );
}

export async function updateMemberRole(
  workspaceId: string,
  memberId: string,
  role: 'admin' | 'member' | 'read_only',
) {
  return apiRequest(`/api/workspaces/members/${memberId}`, {
    method: 'PATCH',
    workspaceId,
    body: { role },
  });
}

export async function removeWorkspaceMember(workspaceId: string, memberId: string) {
  return apiRequest(`/api/workspaces/members/${memberId}`, {
    method: 'DELETE',
    workspaceId,
  });
}

export async function fetchUserSettings(workspaceId: string): Promise<{
  settings: {
    language: 'uz' | 'ru' | 'en';
    theme: 'system' | 'dark' | 'light';
    reportingCurrency: string;
    timezone: string;
    hideBalances: boolean;
  };
  notificationPreferences: {
    telegram_enabled: boolean;
    budget_warnings: boolean;
    upcoming_payments: boolean;
    debt_reminders: boolean;
    goal_milestones: boolean;
    weekly_summary: boolean;
    monthly_summary: boolean;
  };
}> {
  return apiRequest('/api/workspaces/settings', { workspaceId });
}

export async function updateUserSettings(
  workspaceId: string,
  payload: Record<string, unknown>,
) {
  return apiRequest('/api/workspaces/settings', {
    method: 'PATCH',
    workspaceId,
    body: payload,
  });
}

export async function deleteUserAccount(workspaceId: string) {
  return apiRequest('/api/workspaces/account', { method: 'DELETE', workspaceId });
}

export async function fetchNotifications(workspaceId: string): Promise<{
  unreadCount: number;
  notifications: NotificationItem[];
}> {
  return apiRequest('/api/notifications', { workspaceId });
}

export async function markNotificationsRead(workspaceId: string) {
  return apiRequest('/api/notifications/read', { method: 'POST', workspaceId });
}
