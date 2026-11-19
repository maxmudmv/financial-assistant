export type AccountType =
  | 'cash'
  | 'bank_card'
  | 'bank_account'
  | 'savings'
  | 'investment'
  | 'e_wallet'
  | 'credit'
  | 'other';

export type AccountVisibility = 'workspace' | 'private' | 'selected_members';

export type TransactionType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'refund'
  | 'adjustment'
  | 'savings_contribution'
  | 'savings_withdrawal'
  | 'debt_repayment';

export type TransactionStatus = 'posted' | 'voided' | 'pending';

export interface ResolvedRateInfo {
  rateId: string | null;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  source: string;
  isManual: boolean;
  isTriangulated: boolean;
  isOutdated: boolean;
  effectiveAt: string;
  fetchedAt: string;
}

export interface FinanceAccount {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: string;
  currentBalance: string;
  reportingCurrency?: string;
  convertedBalance?: string | null;
  exchangeRate?: ResolvedRateInfo | null;
  visibility: AccountVisibility;
  allowedMemberIds: string[];
  color: string | null;
  icon: string | null;
  includeInNetWorth: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccountsListResponse {
  workspaceId: string;
  reportingCurrency: string;
  summary: {
    totalBalance: string;
    netWorth: string;
    hasOutdatedRates: boolean;
    missingRateCurrencies: string[];
    accountCount: number;
  };
  accounts: FinanceAccount[];
}

export interface FinanceCategory {
  id: string;
  name: string;
  name_uz: string | null;
  name_ru: string | null;
  name_en: string | null;
  type: 'income' | 'expense' | 'both';
  icon: string | null;
  color: string | null;
  is_system: boolean;
  sort_order: number;
}

export interface FinanceTransaction {
  id: string;
  workspaceId: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  category: FinanceCategory | null;
  createdBy: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: string;
  reportingCurrency: string | null;
  exchangeRateUsed: string | null;
  reportingAmount: string | null;
  occurredAt: string;
  description: string | null;
  notes: string | null;
  tags: string[];
  isPrivate: boolean;
  transferId: string | null;
  createdAt: string;
}

export interface LedgerEntryItem {
  id: string;
  transactionId?: string;
  accountId: string;
  accountName?: string;
  entryGroupId: string;
  direction: 'debit' | 'credit';
  amount: string;
  signedAmount: string;
  currency: string;
  balanceAfter: string;
  isReversal: boolean;
  reversedEntryId: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface FinanceTransfer {
  id: string;
  fromAccountId: string;
  fromAccountName: string;
  toAccountId: string;
  toAccountName: string;
  fromAmount: string;
  fromCurrency: string;
  toAmount: string;
  toCurrency: string;
  exchangeRate: string;
  feeAmount: string;
  feeCurrency: string | null;
  occurredAt: string;
  notes: string | null;
  status: TransactionStatus;
  createdAt: string;
}

export interface ExchangeRatesResponse {
  quoteCurrency: string;
  initialCurrencies: string[];
  supportedCurrencies: string[];
  matrix: Array<{
    baseCurrency: string;
    quoteCurrency: string;
    resolved: ResolvedRateInfo | null;
  }>;
  history: Array<{
    id: string;
    workspaceId: string | null;
    baseCurrency: string;
    quoteCurrency: string;
    rate: string;
    source: string;
    isManual: boolean;
    effectiveAt: string;
    fetchedAt: string;
  }>;
}

export interface ReconciliationResponse {
  workspaceId: string;
  checkedAt: string;
  allBalanced: boolean;
  accounts: Array<{
    accountId: string;
    accountName: string;
    currency: string;
    openingBalance: string;
    ledgerNetSum: string;
    expectedBalance: string;
    recordedBalance: string;
    discrepancy: string;
    isBalanced: boolean;
    entryCount: number;
  }>;
}
