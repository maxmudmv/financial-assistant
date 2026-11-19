-- ==============================================================================
-- FINORA Seed Data (Idempotent Baseline Exchange Rates)
-- Clearly marked as 'manual_seed' — NEVER presented as live market data.
-- ==============================================================================

INSERT INTO public.exchange_rates (
  workspace_id,
  base_currency,
  quote_currency,
  rate,
  source,
  is_manual,
  effective_at,
  fetched_at
)
SELECT v.workspace_id, v.base_currency, v.quote_currency, v.rate, v.source, v.is_manual, v.effective_at, v.fetched_at
FROM (
  VALUES
    (NULL::UUID, 'USD'::CHAR(3), 'UZS'::CHAR(3), 12800.00000000::NUMERIC(20,8), 'manual_seed', false, now(), now()),
    (NULL::UUID, 'EUR'::CHAR(3), 'UZS'::CHAR(3), 13900.00000000::NUMERIC(20,8), 'manual_seed', false, now(), now()),
    (NULL::UUID, 'RUB'::CHAR(3), 'UZS'::CHAR(3), 135.00000000::NUMERIC(20,8), 'manual_seed', false, now(), now()),
    (NULL::UUID, 'GBP'::CHAR(3), 'UZS'::CHAR(3), 16300.00000000::NUMERIC(20,8), 'manual_seed', false, now(), now()),
    (NULL::UUID, 'USD'::CHAR(3), 'EUR'::CHAR(3), 0.92000000::NUMERIC(20,8), 'manual_seed', false, now(), now()),
    (NULL::UUID, 'USD'::CHAR(3), 'RUB'::CHAR(3), 94.80000000::NUMERIC(20,8), 'manual_seed', false, now(), now()),
    (NULL::UUID, 'USD'::CHAR(3), 'GBP'::CHAR(3), 0.78500000::NUMERIC(20,8), 'manual_seed', false, now(), now())
) AS v(workspace_id, base_currency, quote_currency, rate, source, is_manual, effective_at, fetched_at)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.exchange_rates er
  WHERE er.workspace_id IS NULL
    AND er.base_currency = v.base_currency
    AND er.quote_currency = v.quote_currency
    AND er.source = 'manual_seed'
);
