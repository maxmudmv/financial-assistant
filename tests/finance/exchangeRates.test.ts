import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  refreshFreeExchangeRates,
  resolveRateFromRows,
  type ExchangeRateRow,
} from '../../server/finance/exchangeRates';

const NOW_MS = new Date('2026-11-19T12:00:00.000Z').getTime();

const SAMPLE_RATES: ExchangeRateRow[] = [
  {
    id: 'rate-seed-usd-uzs',
    workspace_id: null,
    base_currency: 'USD',
    quote_currency: 'UZS',
    rate: '12800.00000000',
    source: 'manual_seed',
    is_manual: false,
    effective_at: '2026-11-01T00:00:00.000Z',
    fetched_at: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'rate-fresh-usd-uzs',
    workspace_id: null,
    base_currency: 'USD',
    quote_currency: 'UZS',
    rate: '12950.00000000',
    source: 'open.er-api.com',
    is_manual: false,
    effective_at: '2026-11-19T08:00:00.000Z',
    fetched_at: '2026-11-19T08:00:00.000Z',
  },
  {
    id: 'rate-fresh-usd-eur',
    workspace_id: null,
    base_currency: 'USD',
    quote_currency: 'EUR',
    rate: '0.92000000',
    source: 'open.er-api.com',
    is_manual: false,
    effective_at: '2026-11-19T08:00:00.000Z',
    fetched_at: '2026-11-19T08:00:00.000Z',
  },
  {
    id: 'rate-manual-ws-a',
    workspace_id: 'ws-a',
    base_currency: 'USD',
    quote_currency: 'UZS',
    rate: '13000.00000000',
    source: 'manual_user',
    is_manual: true,
    effective_at: '2026-11-19T09:00:00.000Z',
    fetched_at: '2026-11-19T09:00:00.000Z',
  },
];

describe('Multi-currency exchange rate engine & zero-cost honesty rules', () => {
  it('returns identity 1.00000000 for identical currencies', () => {
    const res = resolveRateFromRows({
      rows: SAMPLE_RATES,
      baseCurrency: 'UZS',
      quoteCurrency: 'UZS',
      nowMs: NOW_MS,
    });
    expect(res?.rate).toBe('1.00000000');
    expect(res?.isOutdated).toBe(false);
    expect(res?.source).toBe('identity');
  });

  it('prioritizes workspace manual override only for that workspace and isolates others', () => {
    const wsA = resolveRateFromRows({
      rows: SAMPLE_RATES,
      baseCurrency: 'USD',
      quoteCurrency: 'UZS',
      workspaceId: 'ws-a',
      nowMs: NOW_MS,
    });
    expect(wsA?.rate).toBe('13000.00000000');
    expect(wsA?.isManual).toBe(true);
    expect(wsA?.isOutdated).toBe(false);

    const wsB = resolveRateFromRows({
      rows: SAMPLE_RATES,
      baseCurrency: 'USD',
      quoteCurrency: 'UZS',
      workspaceId: 'ws-b',
      nowMs: NOW_MS,
    });
    expect(wsB?.rate).toBe('12950.00000000');
    expect(wsB?.isManual).toBe(false);
    expect(wsB?.isOutdated).toBe(false);
  });

  it('computes inverse pairs and USD-triangulated pairs accurately', () => {
    const inverse = resolveRateFromRows({
      rows: SAMPLE_RATES,
      baseCurrency: 'UZS',
      quoteCurrency: 'USD',
      workspaceId: 'ws-b',
      nowMs: NOW_MS,
    });
    expect(inverse?.rate).toBe('0.00007722');

    // EUR -> UZS via USD: (1 / 0.92) * 12950 = 14076.08695652
    const triangulated = resolveRateFromRows({
      rows: SAMPLE_RATES,
      baseCurrency: 'EUR',
      quoteCurrency: 'UZS',
      workspaceId: 'ws-b',
      nowMs: NOW_MS,
    });
    expect(triangulated?.isTriangulated).toBe(true);
    expect(triangulated?.rate).toBe('14076.08695652');
  });

  it('preserves historical rate lookup using asOfDate and honestly labels stale/seed rates outdated', () => {
    const historical = resolveRateFromRows({
      rows: SAMPLE_RATES,
      baseCurrency: 'USD',
      quoteCurrency: 'UZS',
      workspaceId: 'ws-b',
      asOfDate: new Date('2026-11-10T00:00:00.000Z'),
      nowMs: NOW_MS,
    });
    expect(historical?.rate).toBe('12800.00000000');
    expect(historical?.source).toBe('manual_seed');
    expect(historical?.isOutdated).toBe(true);

    // 48 hours later, fresh provider rate becomes honestly labeled outdated
    const laterMs = NOW_MS + 48 * 3600 * 1000;
    const staleLater = resolveRateFromRows({
      rows: SAMPLE_RATES,
      baseCurrency: 'USD',
      quoteCurrency: 'UZS',
      workspaceId: 'ws-b',
      nowMs: laterMs,
    });
    expect(staleLater?.isOutdated).toBe(true);
  });

  it('handles unavailable free FX providers gracefully without crashing', async () => {
    const fakeSupabase = {} as SupabaseClient;
    const offlineFetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const result = await refreshFreeExchangeRates({
      supabase: fakeSupabase,
      fetchImpl: offlineFetch,
    });

    expect(result.refreshed).toBe(false);
    expect(result.insertedCount).toBe(0);
    expect(result.source).toBe('free_provider_unavailable');
  });
});
