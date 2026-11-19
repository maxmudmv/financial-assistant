import { describe, expect, it } from 'vitest';
import { FinancialLedgerEngine } from '../../server/finance/ledgerEngine';
import { ConflictError } from '../../server/security/errors';

describe('Immutable financial ledger engine, transfers, idempotency & reconciliation', () => {
  it('posts income, expenses, refunds, adjustments and reconciles 100% with immutable ledger', () => {
    const engine = new FinancialLedgerEngine();
    const ws = 'ws-1';
    const user = 'user-1';

    const acc = engine.createAccount({
      workspaceId: ws,
      ownerUserId: user,
      name: 'Main Card',
      currency: 'UZS',
      openingBalance: '1000000.0000',
    });

    engine.postTransaction({
      workspaceId: ws,
      accountId: acc.id,
      createdBy: user,
      type: 'income',
      amount: '2500000',
      description: 'Salary',
    });
    engine.postTransaction({
      workspaceId: ws,
      accountId: acc.id,
      createdBy: user,
      type: 'expense',
      amount: '450000.50',
      description: 'Groceries',
    });
    engine.postTransaction({
      workspaceId: ws,
      accountId: acc.id,
      createdBy: user,
      type: 'refund',
      amount: '50000.50',
      description: 'Returned item',
    });
    engine.postTransaction({
      workspaceId: ws,
      accountId: acc.id,
      createdBy: user,
      type: 'adjustment',
      adjustmentDirection: 'debit',
      amount: '100000',
      description: 'Bank fee adjustment',
    });

    // 1,000,000 + 2,500,000 - 450,000.50 + 50,000.50 - 100,000 = 3,000,000.0000
    expect(engine.getAccount(acc.id)?.currentBalance).toBe('3000000.0000');

    const reconciliation = engine.reconcileAccount(acc.id);
    expect(reconciliation.isBalanced).toBe(true);
    expect(reconciliation.discrepancy).toBe('0.0000');
    expect(reconciliation.expectedBalance).toBe('3000000.0000');
  });

  it('edits and voids transactions using append-only ledger reversals (never mutates existing entries)', () => {
    const engine = new FinancialLedgerEngine();
    const ws = 'ws-1';
    const user = 'user-1';

    const accA = engine.createAccount({
      workspaceId: ws,
      ownerUserId: user,
      name: 'Cash',
      currency: 'USD',
      openingBalance: '500',
    });
    const accB = engine.createAccount({
      workspaceId: ws,
      ownerUserId: user,
      name: 'Bank',
      currency: 'USD',
      openingBalance: '1000',
    });

    const posted = engine.postTransaction({
      workspaceId: ws,
      accountId: accA.id,
      createdBy: user,
      type: 'expense',
      amount: '120',
    });
    expect(engine.getAccount(accA.id)?.currentBalance).toBe('380.0000');
    const originalEntryId = posted.entry.id;

    // Edit transaction: move from Cash ($120) to Bank ($150)
    const edited = engine.editTransaction({
      workspaceId: ws,
      transactionId: posted.transaction.id,
      actorUserId: user,
      accountId: accB.id,
      type: 'expense',
      amount: '150',
    });
    expect(edited.ledgerReposted).toBe(true);
    expect(engine.getAccount(accA.id)?.currentBalance).toBe('500.0000');
    expect(engine.getAccount(accB.id)?.currentBalance).toBe('850.0000');

    // Original ledger entry is still preserved unchanged, plus a reversal + new entry exist
    const allEntries = engine.getLedgerEntries();
    expect(allEntries).toHaveLength(3);
    expect(allEntries[0].id).toBe(originalEntryId);
    expect(allEntries[0].amount).toBe('120.0000');
    expect(allEntries[1].isReversal).toBe(true);
    expect(allEntries[1].reversedEntryId).toBe(originalEntryId);

    // Void transaction -> appends reversal on Bank, restoring $1000
    engine.voidTransaction({
      workspaceId: ws,
      transactionId: posted.transaction.id,
      actorUserId: user,
    });
    expect(engine.getAccount(accB.id)?.currentBalance).toBe('1000.0000');
    expect(engine.getLedgerEntries()).toHaveLength(4);

    // Double void must be rejected
    expect(() =>
      engine.voidTransaction({
        workspaceId: ws,
        transactionId: posted.transaction.id,
        actorUserId: user,
      }),
    ).toThrowError(ConflictError);

    expect(engine.reconcileAccount(accA.id).isBalanced).toBe(true);
    expect(engine.reconcileAccount(accB.id).isBalanced).toBe(true);
  });

  it('prevents duplicate financial postings via idempotency keys and rejects payload mismatch', () => {
    const engine = new FinancialLedgerEngine();
    const ws = 'ws-1';
    const user = 'user-1';
    const acc = engine.createAccount({
      workspaceId: ws,
      ownerUserId: user,
      name: 'Wallet',
      currency: 'USD',
      openingBalance: '100',
    });

    const first = engine.postTransaction({
      workspaceId: ws,
      accountId: acc.id,
      createdBy: user,
      type: 'expense',
      amount: '25',
      idempotencyKey: 'retry-key-001',
    });
    const retry = engine.postTransaction({
      workspaceId: ws,
      accountId: acc.id,
      createdBy: user,
      type: 'expense',
      amount: '25',
      idempotencyKey: 'retry-key-001',
    });

    expect(first.isDuplicate).toBe(false);
    expect(retry.isDuplicate).toBe(true);
    expect(retry.transaction.id).toBe(first.transaction.id);
    // Account debited strictly ONCE ($100 - $25 = $75)
    expect(engine.getAccount(acc.id)?.currentBalance).toBe('75.0000');
    expect(engine.getLedgerEntries(acc.id)).toHaveLength(1);

    // Reusing the same idempotency key with a different amount must throw ConflictError
    expect(() =>
      engine.postTransaction({
        workspaceId: ws,
        accountId: acc.id,
        createdBy: user,
        type: 'expense',
        amount: '30',
        idempotencyKey: 'retry-key-001',
      }),
    ).toThrowError(ConflictError);
  });

  it('posts balanced cross-currency transfers, excludes them from income/expense, and voids cleanly', () => {
    const engine = new FinancialLedgerEngine();
    const ws = 'ws-1';
    const user = 'user-1';

    const usdAcc = engine.createAccount({
      workspaceId: ws,
      ownerUserId: user,
      name: 'USD Card',
      currency: 'USD',
      openingBalance: '500',
    });
    const uzsAcc = engine.createAccount({
      workspaceId: ws,
      ownerUserId: user,
      name: 'UZS Card',
      currency: 'UZS',
      openingBalance: '1000000',
    });

    const { transfer } = engine.postTransfer({
      workspaceId: ws,
      createdBy: user,
      fromAccountId: usdAcc.id,
      toAccountId: uzsAcc.id,
      fromAmount: '100',
      exchangeRate: '12850',
      feeAmount: '2',
      idempotencyKey: 'tr-key-001',
    });

    // Retry transfer with same idempotency key -> no double transfer!
    const retry = engine.postTransfer({
      workspaceId: ws,
      createdBy: user,
      fromAccountId: usdAcc.id,
      toAccountId: uzsAcc.id,
      fromAmount: '100',
      exchangeRate: '12850',
      feeAmount: '2',
      idempotencyKey: 'tr-key-001',
    });
    expect(retry.isDuplicate).toBe(true);

    // USD: 500 - 100 - 2 fee = 398.0000; UZS: 1,000,000 + 1,285,000 = 2,285,000.0000
    expect(engine.getAccount(usdAcc.id)?.currentBalance).toBe('398.0000');
    expect(engine.getAccount(uzsAcc.id)?.currentBalance).toBe('2285000.0000');

    // Internal transfers MUST NOT be counted as income or expense
    const cashFlow = engine.computeCashFlowSummary(ws);
    expect(cashFlow.totalIncome).toBe('0.0000');
    expect(cashFlow.totalExpenses).toBe('0.0000');

    // Void transfer -> restores both accounts including fee
    engine.voidTransfer({
      workspaceId: ws,
      transferId: transfer.id,
      actorUserId: user,
    });
    expect(engine.getAccount(usdAcc.id)?.currentBalance).toBe('500.0000');
    expect(engine.getAccount(uzsAcc.id)?.currentBalance).toBe('1000000.0000');
    expect(engine.reconcileAccount(usdAcc.id).isBalanced).toBe(true);
    expect(engine.reconcileAccount(uzsAcc.id).isBalanced).toBe(true);
  });
});
