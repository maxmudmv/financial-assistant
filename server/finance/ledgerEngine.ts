import crypto from 'node:crypto';
import Decimal from 'decimal.js';
import { ConflictError, NotFoundError, ValidationError } from '../security/errors';
import {
  addMoney,
  computeBalancedTransfer,
  evaluateAccountReconciliation,
  formatMoneyFixed4,
  normalizeCurrencyCode,
  parseMoney,
  parsePositiveMoney,
  resolveTransactionDirection,
  signedDeltaForEntry,
  type LedgerDirection,
  type LedgerTransactionType,
  type ReconciliationSummary,
} from './money';

export interface LedgerAccountState {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  name: string;
  currency: string;
  openingBalance: string;
  currentBalance: string;
  isArchived: boolean;
}

export interface LedgerTransactionState {
  id: string;
  workspaceId: string;
  accountId: string;
  createdBy: string;
  type: LedgerTransactionType;
  status: 'posted' | 'voided';
  amount: string;
  currency: string;
  reportingCurrency: string | null;
  exchangeRateUsed: string | null;
  reportingAmount: string | null;
  occurredAt: string;
  description: string | null;
  notes: string | null;
  isPrivate: boolean;
  transferId: string | null;
  idempotencyKey: string | null;
}

export interface ImmutableLedgerEntry {
  readonly id: string;
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly accountId: string;
  readonly entryGroupId: string;
  readonly direction: LedgerDirection;
  readonly amount: string;
  readonly signedAmount: string;
  readonly currency: string;
  readonly balanceAfter: string;
  readonly isReversal: boolean;
  readonly reversedEntryId: string | null;
  readonly occurredAt: string;
  readonly createdBy: string;
}

export interface LedgerTransferState {
  id: string;
  workspaceId: string;
  createdBy: string;
  fromAccountId: string;
  toAccountId: string;
  fromAmount: string;
  fromCurrency: string;
  toAmount: string;
  toCurrency: string;
  exchangeRate: string;
  feeAmount: string;
  outgoingTransactionId: string;
  incomingTransactionId: string;
  status: 'posted' | 'voided';
  idempotencyKey: string | null;
}

/**
 * Deterministic decimal-safe financial ledger engine mirroring `0008_financial_engine_rpcs.sql`.
 * Enforces immutable append-only ledger entries, idempotency, balanced transfers,
 * historical exchange-rate immutability, and reconciliation invariants.
 */
export class FinancialLedgerEngine {
  private readonly accounts = new Map<string, LedgerAccountState>();
  private readonly transactions = new Map<string, LedgerTransactionState>();
  private readonly transfers = new Map<string, LedgerTransferState>();
  private readonly ledgerEntries: ImmutableLedgerEntry[] = [];
  private readonly idempotencyHashes = new Map<string, { payloadHash: string; entityId: string }>();

  createAccount(input: {
    id?: string;
    workspaceId: string;
    ownerUserId: string;
    name: string;
    currency: string;
    openingBalance?: string | number;
  }): LedgerAccountState {
    const currency = normalizeCurrencyCode(input.currency);
    const opening = formatMoneyFixed4(parseMoney(input.openingBalance ?? '0', 'openingBalance'));
    const account: LedgerAccountState = {
      id: input.id ?? crypto.randomUUID(),
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      name: input.name.trim(),
      currency,
      openingBalance: opening,
      currentBalance: opening,
      isArchived: false,
    };
    this.accounts.set(account.id, account);
    return { ...account };
  }

  getAccount(accountId: string): LedgerAccountState | undefined {
    const acc = this.accounts.get(accountId);
    return acc ? { ...acc } : undefined;
  }

  getLedgerEntries(accountId?: string): readonly ImmutableLedgerEntry[] {
    return accountId
      ? this.ledgerEntries.filter((e) => e.accountId === accountId)
      : [...this.ledgerEntries];
  }

  postTransaction(input: {
    workspaceId: string;
    accountId: string;
    createdBy: string;
    type: Exclude<LedgerTransactionType, 'transfer'>;
    amount: string | number;
    reportingCurrency?: string | null;
    exchangeRateUsed?: string | null;
    reportingAmount?: string | null;
    occurredAt?: string;
    description?: string | null;
    notes?: string | null;
    isPrivate?: boolean;
    idempotencyKey?: string | null;
    adjustmentDirection?: LedgerDirection;
  }): { transaction: LedgerTransactionState; entry: ImmutableLedgerEntry; isDuplicate: boolean } {
    const amount = formatMoneyFixed4(parsePositiveMoney(input.amount, 'amount'));

    if (input.idempotencyKey) {
      const scopeKey = `tx:${input.workspaceId}:${input.createdBy}:${input.idempotencyKey}`;
      const payloadHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ a: input.accountId, t: input.type, amt: amount }))
        .digest('hex');

      const existing = this.idempotencyHashes.get(scopeKey);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new ConflictError('Idempotency key reused with a different transaction payload');
        }
        const tx = this.transactions.get(existing.entityId)!;
        const entry = [...this.ledgerEntries]
          .reverse()
          .find((e) => e.transactionId === tx.id)!;
        return { transaction: { ...tx }, entry, isDuplicate: true };
      }

      const result = this.executePostTransaction({ ...input, amount });
      this.idempotencyHashes.set(scopeKey, { payloadHash, entityId: result.transaction.id });
      return { ...result, isDuplicate: false };
    }

    const result = this.executePostTransaction({ ...input, amount });
    return { ...result, isDuplicate: false };
  }

  private executePostTransaction(input: {
    workspaceId: string;
    accountId: string;
    createdBy: string;
    type: Exclude<LedgerTransactionType, 'transfer'>;
    amount: string;
    reportingCurrency?: string | null;
    exchangeRateUsed?: string | null;
    reportingAmount?: string | null;
    occurredAt?: string;
    description?: string | null;
    notes?: string | null;
    isPrivate?: boolean;
    idempotencyKey?: string | null;
    adjustmentDirection?: LedgerDirection;
  }): { transaction: LedgerTransactionState; entry: ImmutableLedgerEntry } {
    const account = this.accounts.get(input.accountId);
    if (!account || account.workspaceId !== input.workspaceId) {
      throw new NotFoundError('Account not found in workspace');
    }
    if (account.isArchived) {
      throw new ValidationError('Cannot post to an archived account');
    }

    const direction = resolveTransactionDirection(input.type, input.adjustmentDirection);
    const signedAmount = signedDeltaForEntry(input.amount, direction);
    const newBalance = addMoney(account.currentBalance, signedAmount);
    const occurredAt = input.occurredAt ?? new Date().toISOString();

    const tx: LedgerTransactionState = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      accountId: account.id,
      createdBy: input.createdBy,
      type: input.type,
      status: 'posted',
      amount: input.amount,
      currency: account.currency,
      reportingCurrency: input.reportingCurrency ?? null,
      exchangeRateUsed: input.exchangeRateUsed ?? null,
      reportingAmount: input.reportingAmount ?? null,
      occurredAt,
      description: input.description ?? null,
      notes: input.notes ?? null,
      isPrivate: Boolean(input.isPrivate),
      transferId: null,
      idempotencyKey: input.idempotencyKey ?? null,
    };

    const entry: ImmutableLedgerEntry = Object.freeze({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      transactionId: tx.id,
      accountId: account.id,
      entryGroupId: crypto.randomUUID(),
      direction,
      amount: input.amount,
      signedAmount,
      currency: account.currency,
      balanceAfter: newBalance,
      isReversal: false,
      reversedEntryId: null,
      occurredAt,
      createdBy: input.createdBy,
    });

    this.transactions.set(tx.id, tx);
    this.ledgerEntries.push(entry);
    account.currentBalance = newBalance;

    return { transaction: { ...tx }, entry };
  }

  editTransaction(input: {
    workspaceId: string;
    transactionId: string;
    actorUserId: string;
    accountId: string;
    type: Exclude<LedgerTransactionType, 'transfer'>;
    amount: string | number;
    adjustmentDirection?: LedgerDirection;
  }): { transaction: LedgerTransactionState; ledgerReposted: boolean } {
    const tx = this.transactions.get(input.transactionId);
    if (!tx || tx.workspaceId !== input.workspaceId) {
      throw new NotFoundError('Transaction not found');
    }
    if (tx.status !== 'posted' || tx.type === 'transfer') {
      throw new ValidationError('Only posted non-transfer transactions can be edited');
    }

    const newAmount = formatMoneyFixed4(parsePositiveMoney(input.amount, 'amount'));
    const newDirection = resolveTransactionDirection(input.type, input.adjustmentDirection);
    const lastEntry = [...this.ledgerEntries]
      .reverse()
      .find((e) => e.transactionId === tx.id && !e.isReversal);

    if (!lastEntry) {
      throw new ValidationError('Missing original ledger entry');
    }

    const financialChanged =
      tx.accountId !== input.accountId ||
      tx.amount !== newAmount ||
      tx.type !== input.type ||
      lastEntry.direction !== newDirection;

    if (!financialChanged) {
      return { transaction: { ...tx }, ledgerReposted: false };
    }

    const oldAccount = this.accounts.get(tx.accountId)!;
    const newAccount = this.accounts.get(input.accountId);
    if (!newAccount || newAccount.workspaceId !== input.workspaceId || newAccount.isArchived) {
      throw new ValidationError('Target account is invalid or archived');
    }

    const groupId = crypto.randomUUID();
    const revSigned = formatMoneyFixed4(new Decimal(lastEntry.signedAmount).negated());
    const oldBalanceAfterRev = addMoney(oldAccount.currentBalance, revSigned);

    this.ledgerEntries.push(
      Object.freeze({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        transactionId: tx.id,
        accountId: oldAccount.id,
        entryGroupId: groupId,
        direction: lastEntry.direction === 'credit' ? 'debit' : 'credit',
        amount: lastEntry.amount,
        signedAmount: revSigned,
        currency: oldAccount.currency,
        balanceAfter: oldBalanceAfterRev,
        isReversal: true,
        reversedEntryId: lastEntry.id,
        occurredAt: new Date().toISOString(),
        createdBy: input.actorUserId,
      }),
    );
    oldAccount.currentBalance = oldBalanceAfterRev;

    const nextSigned = signedDeltaForEntry(newAmount, newDirection);
    const nextBalance = addMoney(newAccount.currentBalance, nextSigned);

    this.ledgerEntries.push(
      Object.freeze({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        transactionId: tx.id,
        accountId: newAccount.id,
        entryGroupId: groupId,
        direction: newDirection,
        amount: newAmount,
        signedAmount: nextSigned,
        currency: newAccount.currency,
        balanceAfter: nextBalance,
        isReversal: false,
        reversedEntryId: null,
        occurredAt: tx.occurredAt,
        createdBy: input.actorUserId,
      }),
    );
    newAccount.currentBalance = nextBalance;

    tx.accountId = newAccount.id;
    tx.type = input.type;
    tx.amount = newAmount;
    tx.currency = newAccount.currency;

    return { transaction: { ...tx }, ledgerReposted: true };
  }

  voidTransaction(input: {
    workspaceId: string;
    transactionId: string;
    actorUserId: string;
  }): { transaction: LedgerTransactionState; reversalEntry: ImmutableLedgerEntry } {
    const tx = this.transactions.get(input.transactionId);
    if (!tx || tx.workspaceId !== input.workspaceId) {
      throw new NotFoundError('Transaction not found');
    }
    if (tx.status === 'voided') {
      throw new ConflictError('Transaction is already voided');
    }
    if (tx.type === 'transfer') {
      throw new ValidationError('Use voidTransfer for internal transfers');
    }

    const account = this.accounts.get(tx.accountId)!;
    const lastEntry = [...this.ledgerEntries]
      .reverse()
      .find((e) => e.transactionId === tx.id && !e.isReversal)!;

    const revSigned = formatMoneyFixed4(new Decimal(lastEntry.signedAmount).negated());
    const newBalance = addMoney(account.currentBalance, revSigned);

    const reversalEntry: ImmutableLedgerEntry = Object.freeze({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      transactionId: tx.id,
      accountId: account.id,
      entryGroupId: crypto.randomUUID(),
      direction: lastEntry.direction === 'credit' ? 'debit' : 'credit',
      amount: lastEntry.amount,
      signedAmount: revSigned,
      currency: account.currency,
      balanceAfter: newBalance,
      isReversal: true,
      reversedEntryId: lastEntry.id,
      occurredAt: new Date().toISOString(),
      createdBy: input.actorUserId,
    });

    this.ledgerEntries.push(reversalEntry);
    account.currentBalance = newBalance;
    tx.status = 'voided';

    return { transaction: { ...tx }, reversalEntry };
  }

  postTransfer(input: {
    workspaceId: string;
    createdBy: string;
    fromAccountId: string;
    toAccountId: string;
    fromAmount: string | number;
    toAmount?: string | number;
    exchangeRate?: string | number;
    feeAmount?: string | number;
    idempotencyKey?: string | null;
  }): { transfer: LedgerTransferState; isDuplicate: boolean } {
    if (input.fromAccountId === input.toAccountId) {
      throw new ValidationError('Source and destination accounts must be different');
    }

    const fromAcc = this.accounts.get(input.fromAccountId);
    const toAcc = this.accounts.get(input.toAccountId);
    if (
      !fromAcc ||
      !toAcc ||
      fromAcc.workspaceId !== input.workspaceId ||
      toAcc.workspaceId !== input.workspaceId
    ) {
      throw new NotFoundError('Transfer account not found in workspace');
    }

    const calc = computeBalancedTransfer({
      fromCurrency: fromAcc.currency,
      toCurrency: toAcc.currency,
      fromAmount: input.fromAmount,
      toAmount: input.toAmount,
      exchangeRate: input.exchangeRate,
      feeAmount: input.feeAmount,
    });

    if (input.idempotencyKey) {
      const scopeKey = `tr:${input.workspaceId}:${input.createdBy}:${input.idempotencyKey}`;
      const payloadHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ f: fromAcc.id, t: toAcc.id, calc }))
        .digest('hex');

      const existing = this.idempotencyHashes.get(scopeKey);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new ConflictError('Idempotency key reused with different transfer details');
        }
        return { transfer: { ...this.transfers.get(existing.entityId)! }, isDuplicate: true };
      }

      const transfer = this.executeTransfer(input.workspaceId, input.createdBy, fromAcc, toAcc, calc, input.idempotencyKey);
      this.idempotencyHashes.set(scopeKey, { payloadHash, entityId: transfer.id });
      return { transfer: { ...transfer }, isDuplicate: false };
    }

    const transfer = this.executeTransfer(input.workspaceId, input.createdBy, fromAcc, toAcc, calc, null);
    return { transfer: { ...transfer }, isDuplicate: false };
  }

  private executeTransfer(
    workspaceId: string,
    createdBy: string,
    fromAcc: LedgerAccountState,
    toAcc: LedgerAccountState,
    calc: ReturnType<typeof computeBalancedTransfer>,
    idempotencyKey: string | null,
  ): LedgerTransferState {
    const groupId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const transferId = crypto.randomUUID();

    const outTxId = crypto.randomUUID();
    const inTxId = crypto.randomUUID();

    this.transactions.set(outTxId, {
      id: outTxId,
      workspaceId,
      accountId: fromAcc.id,
      createdBy,
      type: 'transfer',
      status: 'posted',
      amount: calc.fromAmount,
      currency: fromAcc.currency,
      reportingCurrency: null,
      exchangeRateUsed: null,
      reportingAmount: null,
      occurredAt: nowIso,
      description: `Transfer to ${toAcc.name}`,
      notes: null,
      isPrivate: false,
      transferId,
      idempotencyKey: null,
    });

    this.transactions.set(inTxId, {
      id: inTxId,
      workspaceId,
      accountId: toAcc.id,
      createdBy,
      type: 'transfer',
      status: 'posted',
      amount: calc.toAmount,
      currency: toAcc.currency,
      reportingCurrency: null,
      exchangeRateUsed: null,
      reportingAmount: null,
      occurredAt: nowIso,
      description: `Transfer from ${fromAcc.name}`,
      notes: null,
      isPrivate: false,
      transferId,
      idempotencyKey: null,
    });

    const afterPrincipal = addMoney(fromAcc.currentBalance, signedDeltaForEntry(calc.fromAmount, 'debit'));
    this.ledgerEntries.push(
      Object.freeze({
        id: crypto.randomUUID(),
        workspaceId,
        transactionId: outTxId,
        accountId: fromAcc.id,
        entryGroupId: groupId,
        direction: 'debit',
        amount: calc.fromAmount,
        signedAmount: signedDeltaForEntry(calc.fromAmount, 'debit'),
        currency: fromAcc.currency,
        balanceAfter: afterPrincipal,
        isReversal: false,
        reversedEntryId: null,
        occurredAt: nowIso,
        createdBy,
      }),
    );

    let finalFromBal = afterPrincipal;
    if (new Decimal(calc.feeAmount).gt(0)) {
      finalFromBal = addMoney(afterPrincipal, signedDeltaForEntry(calc.feeAmount, 'debit'));
      this.ledgerEntries.push(
        Object.freeze({
          id: crypto.randomUUID(),
          workspaceId,
          transactionId: outTxId,
          accountId: fromAcc.id,
          entryGroupId: groupId,
          direction: 'debit',
          amount: calc.feeAmount,
          signedAmount: signedDeltaForEntry(calc.feeAmount, 'debit'),
          currency: fromAcc.currency,
          balanceAfter: finalFromBal,
          isReversal: false,
          reversedEntryId: null,
          occurredAt: nowIso,
          createdBy,
        }),
      );
    }

    const finalToBal = addMoney(toAcc.currentBalance, signedDeltaForEntry(calc.toAmount, 'credit'));
    this.ledgerEntries.push(
      Object.freeze({
        id: crypto.randomUUID(),
        workspaceId,
        transactionId: inTxId,
        accountId: toAcc.id,
        entryGroupId: groupId,
        direction: 'credit',
        amount: calc.toAmount,
        signedAmount: signedDeltaForEntry(calc.toAmount, 'credit'),
        currency: toAcc.currency,
        balanceAfter: finalToBal,
        isReversal: false,
        reversedEntryId: null,
        occurredAt: nowIso,
        createdBy,
      }),
    );

    fromAcc.currentBalance = finalFromBal;
    toAcc.currentBalance = finalToBal;

    const transfer: LedgerTransferState = {
      id: transferId,
      workspaceId,
      createdBy,
      fromAccountId: fromAcc.id,
      toAccountId: toAcc.id,
      fromAmount: calc.fromAmount,
      fromCurrency: fromAcc.currency,
      toAmount: calc.toAmount,
      toCurrency: toAcc.currency,
      exchangeRate: calc.exchangeRate,
      feeAmount: calc.feeAmount,
      outgoingTransactionId: outTxId,
      incomingTransactionId: inTxId,
      status: 'posted',
      idempotencyKey,
    };
    this.transfers.set(transfer.id, transfer);
    return transfer;
  }

  voidTransfer(input: {
    workspaceId: string;
    transferId: string;
    actorUserId: string;
  }): LedgerTransferState {
    const tr = this.transfers.get(input.transferId);
    if (!tr || tr.workspaceId !== input.workspaceId) {
      throw new NotFoundError('Transfer not found');
    }
    if (tr.status === 'voided') {
      throw new ConflictError('Transfer is already voided');
    }

    const originalEntries = this.ledgerEntries.filter(
      (e) =>
        (e.transactionId === tr.outgoingTransactionId ||
          e.transactionId === tr.incomingTransactionId) &&
        !e.isReversal,
    );

    const revGroupId = crypto.randomUUID();
    for (const orig of originalEntries) {
      const acc = this.accounts.get(orig.accountId)!;
      const revSigned = formatMoneyFixed4(new Decimal(orig.signedAmount).negated());
      const nextBal = addMoney(acc.currentBalance, revSigned);

      this.ledgerEntries.push(
        Object.freeze({
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          transactionId: orig.transactionId,
          accountId: orig.accountId,
          entryGroupId: revGroupId,
          direction: orig.direction === 'credit' ? 'debit' : 'credit',
          amount: orig.amount,
          signedAmount: revSigned,
          currency: orig.currency,
          balanceAfter: nextBal,
          isReversal: true,
          reversedEntryId: orig.id,
          occurredAt: new Date().toISOString(),
          createdBy: input.actorUserId,
        }),
      );
      acc.currentBalance = nextBal;
    }

    tr.status = 'voided';
    this.transactions.get(tr.outgoingTransactionId)!.status = 'voided';
    this.transactions.get(tr.incomingTransactionId)!.status = 'voided';

    return { ...tr };
  }

  /**
   * Computes pure income & expense totals explicitly EXCLUDING internal transfers and voided entries.
   */
  computeCashFlowSummary(workspaceId: string): { totalIncome: string; totalExpenses: string } {
    let income = new Decimal(0);
    let expenses = new Decimal(0);

    for (const tx of this.transactions.values()) {
      if (tx.workspaceId !== workspaceId || tx.status !== 'posted') continue;
      if (tx.type === 'transfer') continue; // Internal transfers MUST NOT count as income or expense
      if (tx.type === 'income' || tx.type === 'refund') {
        income = income.plus(tx.amount);
      } else if (tx.type === 'expense') {
        expenses = expenses.plus(tx.amount);
      }
    }

    return {
      totalIncome: formatMoneyFixed4(income),
      totalExpenses: formatMoneyFixed4(expenses),
    };
  }

  reconcileAccount(accountId: string): ReconciliationSummary {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    const entries = this.ledgerEntries.filter((e) => e.accountId === accountId);
    return evaluateAccountReconciliation({
      openingBalance: account.openingBalance,
      ledgerSignedAmounts: entries.map((e) => e.signedAmount),
      recordedBalance: account.currentBalance,
    });
  }
}
