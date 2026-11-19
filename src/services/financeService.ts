import { apiRequest } from '@/lib/apiClient';
import type {
  AccountType,
  AccountVisibility,
  AccountsListResponse,
  ExchangeRatesResponse,
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  FinanceTransfer,
  LedgerEntryItem,
  ReconciliationResponse,
  TransactionType,
} from '@/types/finance';

export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function fetchAccounts(
  workspaceId: string,
  options: { includeArchived?: boolean; reportingCurrency?: string } = {},
): Promise<AccountsListResponse> {
  const params = new URLSearchParams();
  if (options.includeArchived) params.set('includeArchived', 'true');
  if (options.reportingCurrency) params.set('reportingCurrency', options.reportingCurrency);
  const qs = params.toString();
  return apiRequest<AccountsListResponse>(`/api/accounts${qs ? `?${qs}` : ''}`, {
    workspaceId,
  });
}

export async function createAccount(
  workspaceId: string,
  payload: {
    name: string;
    type: AccountType;
    currency: string;
    openingBalance: string;
    visibility: AccountVisibility;
    color?: string;
    includeInNetWorth: boolean;
  },
): Promise<{ account: FinanceAccount }> {
  return apiRequest('/api/accounts', {
    method: 'POST',
    workspaceId,
    body: payload,
  });
}

export async function updateAccount(
  workspaceId: string,
  accountId: string,
  payload: Partial<{
    name: string;
    type: AccountType;
    visibility: AccountVisibility;
    color: string;
    includeInNetWorth: boolean;
    isArchived: boolean;
  }>,
): Promise<{ account: FinanceAccount }> {
  return apiRequest(`/api/accounts/${accountId}`, {
    method: 'PATCH',
    workspaceId,
    body: payload,
  });
}

export async function fetchCategories(workspaceId: string): Promise<{ categories: FinanceCategory[] }> {
  return apiRequest('/api/accounts/categories', { workspaceId });
}

export async function runReconciliation(workspaceId: string): Promise<ReconciliationResponse> {
  return apiRequest('/api/accounts/reconcile', { workspaceId });
}

export async function fetchTransactions(
  workspaceId: string,
  filters: {
    accountId?: string;
    categoryId?: string;
    type?: string;
    status?: string;
    search?: string;
    from?: string;
    to?: string;
    sortBy?: 'occurred_at' | 'amount';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
  } = {},
): Promise<{ transactions: FinanceTransaction[]; total: number }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== 'all') {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return apiRequest(`/api/transactions${qs ? `?${qs}` : ''}`, { workspaceId });
}

export async function createTransaction(
  workspaceId: string,
  payload: {
    accountId: string;
    categoryId?: string | null;
    type: Exclude<TransactionType, 'transfer'>;
    adjustmentDirection?: 'credit' | 'debit';
    amount: string;
    occurredAt?: string;
    description?: string;
    notes?: string;
    tags?: string[];
    isPrivate?: boolean;
  },
  idempotencyKey = generateIdempotencyKey(),
): Promise<{
  transactionId: string;
  ledgerEntryId: string;
  newAccountBalance: string;
  isDuplicate: boolean;
}> {
  return apiRequest('/api/transactions', {
    method: 'POST',
    workspaceId,
    idempotencyKey,
    body: payload,
  });
}

export async function fetchTransactionDetail(
  workspaceId: string,
  transactionId: string,
): Promise<{ transaction: FinanceTransaction; ledgerEntries: LedgerEntryItem[] }> {
  return apiRequest(`/api/transactions/${transactionId}`, { workspaceId });
}

export async function editTransaction(
  workspaceId: string,
  transactionId: string,
  payload: {
    accountId: string;
    categoryId?: string | null;
    type: Exclude<TransactionType, 'transfer'>;
    adjustmentDirection?: 'credit' | 'debit';
    amount: string;
    occurredAt?: string;
    description?: string;
    notes?: string;
    tags?: string[];
    isPrivate?: boolean;
  },
): Promise<{ transactionId: string; newAccountBalance: string; ledgerReposted: boolean }> {
  return apiRequest(`/api/transactions/${transactionId}`, {
    method: 'PATCH',
    workspaceId,
    body: payload,
  });
}

export async function voidTransaction(
  workspaceId: string,
  transactionId: string,
): Promise<{ transactionId: string; reversalEntryId: string; newAccountBalance: string }> {
  return apiRequest(`/api/transactions/${transactionId}/void`, {
    method: 'POST',
    workspaceId,
  });
}

export async function fetchLedgerEntries(
  workspaceId: string,
  accountId?: string,
): Promise<{ entries: LedgerEntryItem[] }> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
  return apiRequest(`/api/transactions/ledger${qs}`, { workspaceId });
}

export async function fetchTransfers(workspaceId: string): Promise<{ transfers: FinanceTransfer[] }> {
  return apiRequest('/api/transfers', { workspaceId });
}

export async function createTransfer(
  workspaceId: string,
  payload: {
    fromAccountId: string;
    toAccountId: string;
    fromAmount: string;
    toAmount?: string;
    exchangeRate?: string;
    feeAmount?: string;
    notes?: string;
  },
  idempotencyKey = generateIdempotencyKey(),
): Promise<{
  transferId: string;
  fromNewBalance: string;
  toNewBalance: string;
  isDuplicate: boolean;
}> {
  return apiRequest('/api/transfers', {
    method: 'POST',
    workspaceId,
    idempotencyKey,
    body: payload,
  });
}

export async function voidTransfer(
  workspaceId: string,
  transferId: string,
): Promise<{ transferId: string; status: string }> {
  return apiRequest(`/api/transfers/${transferId}/void`, {
    method: 'POST',
    workspaceId,
  });
}

export async function fetchExchangeRates(
  workspaceId: string,
  quoteCurrency?: string,
): Promise<ExchangeRatesResponse> {
  const qs = quoteCurrency ? `?quote=${encodeURIComponent(quoteCurrency)}` : '';
  return apiRequest(`/api/transfers/rates${qs}`, { workspaceId });
}

export async function createManualExchangeRate(
  workspaceId: string,
  payload: {
    baseCurrency: string;
    quoteCurrency: string;
    rate: string;
  },
): Promise<{ exchangeRate: { id: string; rate: string } }> {
  return apiRequest('/api/transfers/rates', {
    method: 'POST',
    workspaceId,
    body: payload,
  });
}

export async function refreshExchangeRates(workspaceId: string): Promise<{
  refreshed: boolean;
  source: string;
  fetchedAt: string;
  insertedCount: number;
  errorMessage?: string;
}> {
  return apiRequest('/api/transfers/rates/refresh', {
    method: 'POST',
    workspaceId,
  });
}
