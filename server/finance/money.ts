import Decimal from 'decimal.js';
import { ValidationError } from '../security/errors.js';

// Configure high-precision financial decimal arithmetic (never JS IEEE 754 float)
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
});

export const INITIAL_CURRENCIES = ['UZS', 'USD', 'EUR', 'RUB', 'GBP'] as const;

export const EXTENDED_ISO_4217_CURRENCIES = [
  'UZS',
  'USD',
  'EUR',
  'RUB',
  'GBP',
  'KZT',
  'KGS',
  'TJS',
  'TRY',
  'AED',
  'CNY',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'KRW',
  'INR',
  'PLN',
  'UAH',
  'GEL',
  'AZN',
] as const;

export type LedgerDirection = 'debit' | 'credit';

export type LedgerTransactionType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'refund'
  | 'adjustment'
  | 'savings_contribution'
  | 'savings_withdrawal'
  | 'debt_repayment';

export function normalizeCurrencyCode(code: string): string {
  const cleaned = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cleaned)) {
    throw new ValidationError('Currency must be a valid 3-letter ISO 4217 code');
  }
  return cleaned;
}

export function parseMoney(value: string | number | Decimal, fieldName = 'amount'): Decimal {
  try {
    const dec = new Decimal(value);
    if (!dec.isFinite()) {
      throw new ValidationError(`${fieldName} must be a finite decimal number`);
    }
    return dec;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`${fieldName} must be a valid decimal number`);
  }
}

export function parsePositiveMoney(value: string | number | Decimal, fieldName = 'amount'): Decimal {
  const dec = parseMoney(value, fieldName);
  if (dec.lte(0)) {
    throw new ValidationError(`${fieldName} must be greater than zero`);
  }
  return dec;
}

export function parseNonNegativeMoney(
  value: string | number | Decimal,
  fieldName = 'amount',
): Decimal {
  const dec = parseMoney(value, fieldName);
  if (dec.lt(0)) {
    throw new ValidationError(`${fieldName} cannot be negative`);
  }
  return dec;
}

export function formatMoneyFixed4(value: string | number | Decimal): string {
  return parseMoney(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

export function formatRateFixed8(value: string | number | Decimal): string {
  return parsePositiveMoney(value, 'exchangeRate')
    .toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
    .toFixed(8);
}

export function addMoney(a: string | number | Decimal, b: string | number | Decimal): string {
  return formatMoneyFixed4(parseMoney(a).plus(parseMoney(b)));
}

export function subtractMoney(a: string | number | Decimal, b: string | number | Decimal): string {
  return formatMoneyFixed4(parseMoney(a).minus(parseMoney(b)));
}

export function convertMoney(
  amount: string | number | Decimal,
  exchangeRate: string | number | Decimal,
): string {
  const amt = parseMoney(amount);
  const rate = parsePositiveMoney(exchangeRate, 'exchangeRate');
  return formatMoneyFixed4(amt.times(rate));
}

export function resolveTransactionDirection(
  type: Exclude<LedgerTransactionType, 'transfer'>,
  adjustmentDirection: LedgerDirection = 'credit',
): LedgerDirection {
  switch (type) {
    case 'income':
    case 'refund':
    case 'savings_withdrawal':
      return 'credit';
    case 'expense':
    case 'savings_contribution':
    case 'debt_repayment':
      return 'debit';
    case 'adjustment':
      return adjustmentDirection;
  }
}

export function signedDeltaForEntry(
  amount: string | number | Decimal,
  direction: LedgerDirection,
): string {
  const pos = parsePositiveMoney(amount);
  return formatMoneyFixed4(direction === 'credit' ? pos : pos.negated());
}

export interface BalancedTransferCalculation {
  fromAmount: string;
  toAmount: string;
  exchangeRate: string;
  feeAmount: string;
  totalFromDebit: string;
}

/**
 * Validates and computes decimal-safe transfer amounts for same-currency and cross-currency transfers.
 */
export function computeBalancedTransfer(params: {
  fromCurrency: string;
  toCurrency: string;
  fromAmount: string | number | Decimal;
  toAmount?: string | number | Decimal;
  exchangeRate?: string | number | Decimal;
  feeAmount?: string | number | Decimal;
}): BalancedTransferCalculation {
  const fromCurr = normalizeCurrencyCode(params.fromCurrency);
  const toCurr = normalizeCurrencyCode(params.toCurrency);
  const fromAmt = parsePositiveMoney(params.fromAmount, 'fromAmount');
  const feeAmt =
    params.feeAmount !== undefined ? parseNonNegativeMoney(params.feeAmount, 'feeAmount') : new Decimal(0);

  if (fromCurr === toCurr) {
    if (params.toAmount !== undefined) {
      const providedTo = parsePositiveMoney(params.toAmount, 'toAmount');
      if (!providedTo.eq(fromAmt)) {
        throw new ValidationError('Same-currency transfer must have equal source and destination amounts');
      }
    }
    return {
      fromAmount: formatMoneyFixed4(fromAmt),
      toAmount: formatMoneyFixed4(fromAmt),
      exchangeRate: formatRateFixed8(1),
      feeAmount: formatMoneyFixed4(feeAmt),
      totalFromDebit: formatMoneyFixed4(fromAmt.plus(feeAmt)),
    };
  }

  let rate: Decimal;
  let toAmt: Decimal;

  if (params.toAmount !== undefined && params.exchangeRate === undefined) {
    toAmt = parsePositiveMoney(params.toAmount, 'toAmount');
    rate = toAmt.div(fromAmt);
  } else if (params.exchangeRate !== undefined && params.toAmount === undefined) {
    rate = parsePositiveMoney(params.exchangeRate, 'exchangeRate');
    toAmt = fromAmt.times(rate).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  } else if (params.exchangeRate !== undefined && params.toAmount !== undefined) {
    toAmt = parsePositiveMoney(params.toAmount, 'toAmount');
    rate = parsePositiveMoney(params.exchangeRate, 'exchangeRate');
    const expectedTo = fromAmt.times(rate).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    // Allow tiny rounding tolerance of 0.01 when user enters both rate and destination amount
    if (expectedTo.minus(toAmt).abs().gt(new Decimal('0.01'))) {
      throw new ValidationError(
        'Destination amount does not match source amount multiplied by exchange rate',
      );
    }
  } else {
    throw new ValidationError(
      'Cross-currency transfer requires either exchangeRate or destination toAmount',
    );
  }

  return {
    fromAmount: formatMoneyFixed4(fromAmt),
    toAmount: formatMoneyFixed4(toAmt),
    exchangeRate: formatRateFixed8(rate),
    feeAmount: formatMoneyFixed4(feeAmt),
    totalFromDebit: formatMoneyFixed4(fromAmt.plus(feeAmt)),
  };
}

export interface ReconciliationSummary {
  openingBalance: string;
  ledgerNetSum: string;
  expectedBalance: string;
  recordedBalance: string;
  discrepancy: string;
  isBalanced: boolean;
}

export function evaluateAccountReconciliation(params: {
  openingBalance: string | number | Decimal;
  ledgerSignedAmounts: Array<string | number | Decimal>;
  recordedBalance: string | number | Decimal;
}): ReconciliationSummary {
  const opening = parseMoney(params.openingBalance);
  const netSum = params.ledgerSignedAmounts.reduce<Decimal>(
    (acc, val) => acc.plus(parseMoney(val)),
    new Decimal(0),
  );
  const expected = opening.plus(netSum).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  const recorded = parseMoney(params.recordedBalance).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  const discrepancy = recorded.minus(expected).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

  return {
    openingBalance: formatMoneyFixed4(opening),
    ledgerNetSum: formatMoneyFixed4(netSum),
    expectedBalance: formatMoneyFixed4(expected),
    recordedBalance: formatMoneyFixed4(recorded),
    discrepancy: formatMoneyFixed4(discrepancy),
    isBalanced: discrepancy.isZero(),
  };
}
