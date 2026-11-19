import { describe, expect, it } from 'vitest';
import {
  addMoney,
  computeBalancedTransfer,
  convertMoney,
  evaluateAccountReconciliation,
  normalizeCurrencyCode,
  subtractMoney,
} from '../../server/finance/money';
import { ValidationError } from '../../server/security/errors';

describe('Decimal-safe financial arithmetic & multi-currency math', () => {
  it('avoids IEEE 754 floating-point drift on fractional additions and subtractions', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.3000');
    expect(subtractMoney('1000.00', '999.9999')).toBe('0.0001');
    expect(addMoney('999999999999.1234', '0.8766')).toBe('1000000000000.0000');
  });

  it('converts multi-currency amounts accurately with ROUND_HALF_UP', () => {
    expect(convertMoney('100.00', '12800.50000000')).toBe('1280050.0000');
    expect(convertMoney('1280050.0000', '0.00007812')).toBe('99.9975');
  });

  it('validates ISO 4217 3-letter currency codes', () => {
    expect(normalizeCurrencyCode(' uzs ')).toBe('UZS');
    expect(normalizeCurrencyCode('gbp')).toBe('GBP');
    expect(() => normalizeCurrencyCode('US')).toThrowError(ValidationError);
    expect(() => normalizeCurrencyCode('123')).toThrowError(ValidationError);
  });

  it('computes balanced same-currency and cross-currency transfers with fees', () => {
    const sameCurr = computeBalancedTransfer({
      fromCurrency: 'UZS',
      toCurrency: 'UZS',
      fromAmount: '500000',
      feeAmount: '2500',
    });
    expect(sameCurr).toEqual({
      fromAmount: '500000.0000',
      toAmount: '500000.0000',
      exchangeRate: '1.00000000',
      feeAmount: '2500.0000',
      totalFromDebit: '502500.0000',
    });

    const crossCurr = computeBalancedTransfer({
      fromCurrency: 'USD',
      toCurrency: 'UZS',
      fromAmount: '250',
      exchangeRate: '12850',
      feeAmount: '1.50',
    });
    expect(crossCurr.fromAmount).toBe('250.0000');
    expect(crossCurr.toAmount).toBe('3212500.0000');
    expect(crossCurr.exchangeRate).toBe('12850.00000000');
    expect(crossCurr.totalFromDebit).toBe('251.5000');

    // Rejects unbalanced same-currency transfer
    expect(() =>
      computeBalancedTransfer({
        fromCurrency: 'USD',
        toCurrency: 'USD',
        fromAmount: '100',
        toAmount: '95',
      }),
    ).toThrowError(ValidationError);

    // Rejects inconsistent rate vs destination amount
    expect(() =>
      computeBalancedTransfer({
        fromCurrency: 'USD',
        toCurrency: 'UZS',
        fromAmount: '100',
        exchangeRate: '12800',
        toAmount: '1200000',
      }),
    ).toThrowError(ValidationError);
  });

  it('evaluates account ledger reconciliation and flags any discrepancy', () => {
    const balanced = evaluateAccountReconciliation({
      openingBalance: '1000.0000',
      ledgerSignedAmounts: ['500.0000', '-125.2500', '-74.7500'],
      recordedBalance: '1300.0000',
    });
    expect(balanced.isBalanced).toBe(true);
    expect(balanced.discrepancy).toBe('0.0000');

    const drifted = evaluateAccountReconciliation({
      openingBalance: '1000.0000',
      ledgerSignedAmounts: ['-200.0000'],
      recordedBalance: '805.0000',
    });
    expect(drifted.isBalanced).toBe(false);
    expect(drifted.discrepancy).toBe('5.0000');
  });
});
