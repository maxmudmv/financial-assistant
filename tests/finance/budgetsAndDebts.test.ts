import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { FinancialLedgerEngine } from '../../server/finance/ledgerEngine';
import { formatMoneyFixed4 } from '../../server/finance/money';

describe('Budget threshold calculations & debt repayment invariants', () => {
  it('computes budget spent, remaining, usage %, and crosses 50/75/90/100 thresholds cleanly', () => {
    const limit = new Decimal('1000000.0000');
    const expenses = ['250000', '300000', '360000'];
    const spent = expenses.reduce((acc, e) => acc.plus(e), new Decimal(0));
    const remaining = limit.minus(spent);
    const usagePct = spent.div(limit).times(100).toDecimalPlaces(1).toNumber();

    expect(formatMoneyFixed4(spent)).toBe('910000.0000');
    expect(formatMoneyFixed4(remaining)).toBe('90000.0000');
    expect(usagePct).toBe(91);

    const thresholds = [50, 75, 90, 100];
    const crossed = thresholds.filter((th) => usagePct >= th);
    expect(crossed).toEqual([50, 75, 90]);
    expect(Math.max(...crossed)).toBe(90);
  });

  it('tracks borrowed debt partial & full repayments consistently with immutable ledger', () => {
    const engine = new FinancialLedgerEngine();
    const acc = engine.createAccount({
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      name: 'Main Card',
      currency: 'USD',
      openingBalance: '1000',
    });

    let remainingDebt = new Decimal('400.0000');

    // Partial repayment of $150
    const pay1 = new Decimal('150.0000');
    engine.postTransaction({
      workspaceId: 'ws-1',
      accountId: acc.id,
      createdBy: 'user-1',
      type: 'debt_repayment',
      amount: formatMoneyFixed4(pay1),
      description: 'Debt partial payment',
    });
    remainingDebt = remainingDebt.minus(pay1);
    expect(formatMoneyFixed4(remainingDebt)).toBe('250.0000');
    expect(engine.getAccount(acc.id)?.currentBalance).toBe('850.0000');

    // Full remaining repayment of $250
    const pay2 = remainingDebt;
    engine.postTransaction({
      workspaceId: 'ws-1',
      accountId: acc.id,
      createdBy: 'user-1',
      type: 'debt_repayment',
      amount: formatMoneyFixed4(pay2),
      description: 'Debt final payment',
    });
    remainingDebt = remainingDebt.minus(pay2);
    expect(remainingDebt.isZero()).toBe(true);
    expect(engine.getAccount(acc.id)?.currentBalance).toBe('600.0000');
    expect(engine.reconcileAccount(acc.id).isBalanced).toBe(true);
  });

  it('tracks savings goal deposits & withdrawals consistently with immutable ledger', () => {
    const engine = new FinancialLedgerEngine();
    const acc = engine.createAccount({
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      name: 'Cash',
      currency: 'USD',
      openingBalance: '2000',
    });

    engine.postTransaction({
      workspaceId: 'ws-1',
      accountId: acc.id,
      createdBy: 'user-1',
      type: 'savings_contribution',
      amount: '500',
      description: 'Emergency Fund deposit',
    });
    expect(engine.getAccount(acc.id)?.currentBalance).toBe('1500.0000');

    engine.postTransaction({
      workspaceId: 'ws-1',
      accountId: acc.id,
      createdBy: 'user-1',
      type: 'savings_withdrawal',
      amount: '200',
      description: 'Emergency Fund withdrawal',
    });
    expect(engine.getAccount(acc.id)?.currentBalance).toBe('1700.0000');
    expect(engine.reconcileAccount(acc.id).isBalanced).toBe(true);
  });
});
