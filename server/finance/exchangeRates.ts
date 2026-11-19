import Decimal from 'decimal.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatRateFixed8, normalizeCurrencyCode } from './money.js';

export const DEFAULT_RATE_STALE_HOURS = 24;
export const DEFAULT_FREE_PROVIDER_URL = 'https://open.er-api.com/v6/latest/USD';

export interface ExchangeRateRow {
  id: string;
  workspace_id: string | null;
  base_currency: string;
  quote_currency: string;
  rate: string | number;
  source: string;
  is_manual: boolean;
  effective_at: string;
  fetched_at: string;
}

export interface ResolvedExchangeRate {
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

export function isRateRecordOutdated(
  row: Pick<ExchangeRateRow, 'source' | 'is_manual' | 'fetched_at'>,
  nowMs = Date.now(),
  staleThresholdHours = DEFAULT_RATE_STALE_HOURS,
): boolean {
  if (row.is_manual) return false;
  if (row.source === 'manual_seed') return true;
  const fetchedMs = new Date(row.fetched_at).getTime();
  if (Number.isNaN(fetchedMs)) return true;
  return nowMs - fetchedMs > staleThresholdHours * 3600 * 1000;
}

/**
 * Pure multi-currency resolver supporting:
 * 1. Identity (same currency -> 1.00000000)
 * 2. Workspace manual override (direct or inverse)
 * 3. Latest cached global rate (direct or inverse)
 * 4. Two-hop triangulation via USD or UZS
 * Never fabricates live rates — always surfaces exact source, timestamp, and isOutdated status.
 */
export function resolveRateFromRows(params: {
  rows: ExchangeRateRow[];
  baseCurrency: string;
  quoteCurrency: string;
  workspaceId?: string | null;
  asOfDate?: Date;
  nowMs?: number;
  staleThresholdHours?: number;
}): ResolvedExchangeRate | null {
  const base = normalizeCurrencyCode(params.baseCurrency);
  const quote = normalizeCurrencyCode(params.quoteCurrency);
  const nowMs = params.nowMs ?? Date.now();
  const staleHours = params.staleThresholdHours ?? DEFAULT_RATE_STALE_HOURS;
  const asOfMs = params.asOfDate ? params.asOfDate.getTime() : null;

  if (base === quote) {
    const isoNow = new Date(nowMs).toISOString();
    return {
      rateId: null,
      baseCurrency: base,
      quoteCurrency: quote,
      rate: formatRateFixed8(1),
      source: 'identity',
      isManual: false,
      isTriangulated: false,
      isOutdated: false,
      effectiveAt: isoNow,
      fetchedAt: isoNow,
    };
  }

  // Filter rows by workspace visibility and effective_at <= asOfDate (if historical lookup)
  const eligible = params.rows
    .filter((r) => {
      const matchesScope =
        r.workspace_id === null ||
        (params.workspaceId != null && r.workspace_id === params.workspaceId);
      if (!matchesScope) return false;
      if (asOfMs !== null) {
        const effMs = new Date(r.effective_at).getTime();
        if (!Number.isNaN(effMs) && effMs > asOfMs) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Priority 1: workspace manual override over global cached rates
      const aWorkspaceManual = a.workspace_id !== null && a.is_manual ? 1 : 0;
      const bWorkspaceManual = b.workspace_id !== null && b.is_manual ? 1 : 0;
      if (aWorkspaceManual !== bWorkspaceManual) return bWorkspaceManual - aWorkspaceManual;

      // Priority 2: non-seed rates over manual_seed fallback
      const aNonSeed = a.source !== 'manual_seed' ? 1 : 0;
      const bNonSeed = b.source !== 'manual_seed' ? 1 : 0;
      if (aNonSeed !== bNonSeed) return bNonSeed - aNonSeed;

      // Priority 3: most recent effective_at
      return new Date(b.effective_at).getTime() - new Date(a.effective_at).getTime();
    });

  const findDirectOrInverse = (
    from: string,
    to: string,
  ): { row: ExchangeRateRow; rate: Decimal } | null => {
    for (const row of eligible) {
      const rBase = row.base_currency.trim().toUpperCase();
      const rQuote = row.quote_currency.trim().toUpperCase();
      if (rBase === from && rQuote === to) {
        return { row, rate: new Decimal(row.rate) };
      }
      if (rBase === to && rQuote === from) {
        const dec = new Decimal(row.rate);
        if (dec.gt(0)) {
          return { row, rate: new Decimal(1).div(dec) };
        }
      }
    }
    return null;
  };

  // Direct or inverse pair match
  const direct = findDirectOrInverse(base, quote);
  if (direct) {
    return {
      rateId: direct.row.id,
      baseCurrency: base,
      quoteCurrency: quote,
      rate: formatRateFixed8(direct.rate),
      source: direct.row.source,
      isManual: direct.row.is_manual,
      isTriangulated: false,
      isOutdated: isRateRecordOutdated(direct.row, nowMs, staleHours),
      effectiveAt: direct.row.effective_at,
      fetchedAt: direct.row.fetched_at,
    };
  }

  // Triangulation via pivot currencies (USD, UZS)
  for (const pivot of ['USD', 'UZS']) {
    if (pivot === base || pivot === quote) continue;
    const leg1 = findDirectOrInverse(base, pivot);
    const leg2 = findDirectOrInverse(pivot, quote);
    if (leg1 && leg2) {
      const combined = leg1.rate.times(leg2.rate);
      const olderFetched =
        new Date(leg1.row.fetched_at).getTime() <= new Date(leg2.row.fetched_at).getTime()
          ? leg1.row.fetched_at
          : leg2.row.fetched_at;
      const olderEffective =
        new Date(leg1.row.effective_at).getTime() <= new Date(leg2.row.effective_at).getTime()
          ? leg1.row.effective_at
          : leg2.row.effective_at;

      return {
        rateId: leg1.row.id,
        baseCurrency: base,
        quoteCurrency: quote,
        rate: formatRateFixed8(combined),
        source:
          leg1.row.source === leg2.row.source
            ? leg1.row.source
            : `${leg1.row.source}+${leg2.row.source}`,
        isManual: leg1.row.is_manual && leg2.row.is_manual,
        isTriangulated: true,
        isOutdated:
          isRateRecordOutdated(leg1.row, nowMs, staleHours) ||
          isRateRecordOutdated(leg2.row, nowMs, staleHours),
        effectiveAt: olderEffective,
        fetchedAt: olderFetched,
      };
    }
  }

  return null;
}

export async function fetchWorkspaceExchangeRates(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ExchangeRateRow[]> {
  const { data, error } = await supabase
    .from('exchange_rates')
    .select(
      'id, workspace_id, base_currency, quote_currency, rate, source, is_manual, effective_at, fetched_at',
    )
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
    .order('effective_at', { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`Failed to fetch exchange rates: ${error.message}`);
  }

  return (data ?? []) as ExchangeRateRow[];
}

export interface FreeProviderFetchResult {
  refreshed: boolean;
  providerUrl: string;
  source: string;
  fetchedAt: string;
  insertedCount: number;
  errorMessage?: string;
}

/**
 * Fetches free-tier exchange rates from a configurable open endpoint (defaults to open.er-api.com,
 * zero subscription/API key required) and caches USD-based pairs into `public.exchange_rates`.
 * If the provider is unreachable, fails gracefully without throwing so callers can serve cached
 * rates clearly marked as outdated.
 */
export async function refreshFreeExchangeRates(options: {
  supabase: SupabaseClient;
  providerUrl?: string;
  fetchImpl?: typeof fetch;
  targetCurrencies?: string[];
}): Promise<FreeProviderFetchResult> {
  const providerUrl =
    options.providerUrl || process.env.EXCHANGE_RATE_PROVIDER_URL || DEFAULT_FREE_PROVIDER_URL;
  const fetchFn = options.fetchImpl ?? fetch;
  const fetchedAt = new Date().toISOString();
  const targets = options.targetCurrencies ?? [
    'UZS',
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
  ];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const response = await fetchFn(providerUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      return {
        refreshed: false,
        providerUrl,
        source: 'free_provider_unavailable',
        fetchedAt,
        insertedCount: 0,
        errorMessage: `Provider responded with HTTP ${response.status}`,
      };
    }

    const payload = (await response.json()) as {
      result?: string;
      base_code?: string;
      time_last_update_utc?: string;
      rates?: Record<string, number>;
    };

    const baseCode = (payload.base_code ?? 'USD').trim().toUpperCase();
    const ratesMap = payload.rates;

    if (!ratesMap || typeof ratesMap !== 'object') {
      return {
        refreshed: false,
        providerUrl,
        source: 'free_provider_invalid_payload',
        fetchedAt,
        insertedCount: 0,
        errorMessage: 'Provider returned an unexpected response structure',
      };
    }

    const effectiveAt = payload.time_last_update_utc
      ? new Date(payload.time_last_update_utc).toISOString()
      : fetchedAt;
    const sourceHost = (() => {
      try {
        return new URL(providerUrl).hostname;
      } catch {
        return 'open_fx_provider';
      }
    })();

    const rowsToInsert = targets
      .filter((quote) => quote !== baseCode && typeof ratesMap[quote] === 'number' && ratesMap[quote] > 0)
      .map((quote) => ({
        workspace_id: null,
        base_currency: baseCode,
        quote_currency: quote,
        rate: formatRateFixed8(ratesMap[quote]),
        source: sourceHost,
        is_manual: false,
        effective_at: effectiveAt,
        fetched_at: fetchedAt,
      }));

    if (rowsToInsert.length === 0) {
      return {
        refreshed: false,
        providerUrl,
        source: sourceHost,
        fetchedAt,
        insertedCount: 0,
        errorMessage: 'No supported currency pairs found in provider response',
      };
    }

    const { error: insertErr } = await options.supabase
      .from('exchange_rates')
      .insert(rowsToInsert);

    if (insertErr) {
      return {
        refreshed: false,
        providerUrl,
        source: sourceHost,
        fetchedAt,
        insertedCount: 0,
        errorMessage: insertErr.message,
      };
    }

    return {
      refreshed: true,
      providerUrl,
      source: sourceHost,
      fetchedAt,
      insertedCount: rowsToInsert.length,
    };
  } catch (err) {
    return {
      refreshed: false,
      providerUrl,
      source: 'free_provider_unavailable',
      fetchedAt,
      insertedCount: 0,
      errorMessage: err instanceof Error ? err.message : 'Provider request failed',
    };
  }
}
