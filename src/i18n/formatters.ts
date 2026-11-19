import Decimal from 'decimal.js';
import type { SupportedLanguage } from './types';

const LOCALE_TAGS: Record<SupportedLanguage, string> = {
  uz: 'uz-UZ',
  ru: 'ru-RU',
  en: 'en-US',
};

export function getLocaleTag(language: SupportedLanguage): string {
  return LOCALE_TAGS[language] ?? 'uz-UZ';
}

export function formatMoney(
  amount: string | number | Decimal,
  currency: string,
  language: SupportedLanguage,
): string {
  const decimalValue = new Decimal(amount);
  const numericValue = decimalValue.toNumber();
  const fractionDigits = currency === 'UZS' ? 0 : 2;

  try {
    return new Intl.NumberFormat(getLocaleTag(language), {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(numericValue);
  } catch {
    return `${decimalValue.toFixed(fractionDigits)} ${currency}`;
  }
}

export function formatNumber(value: string | number | Decimal, language: SupportedLanguage): string {
  const numericValue = new Decimal(value).toNumber();
  return new Intl.NumberFormat(getLocaleTag(language)).format(numericValue);
}

export function formatDateTime(
  dateInput: Date | string,
  language: SupportedLanguage,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getLocaleTag(language), options).format(date);
}
