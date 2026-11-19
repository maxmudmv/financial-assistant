# FINORA — Zero-Cost Free-Tier Limits & Architectural Tradeoffs

FINORA is intentionally engineered to run at **$0/month** without VPS, Redis, BullMQ, paid APIs, or paid databases. Every free tier has real limits; FINORA respects them honestly.

## 1. Vercel Hobby (Free)
- **Serverless Function Count**: Maximum **12 Serverless Functions** per deployment.
  - *FINORA Design*: All backend logic lives under `server/` (not counted as functions). `api/` exposes consolidated domain routers (e.g., `api/auth/index.ts` handles `telegram`, `session`, `switch-workspace`, `logout` via `vercel.json` rewrites) so even the completed 10-phase app stays safely under 12 functions.
- **Function Execution Duration**: Up to **10 seconds** per request on Hobby (`maxDuration: 10`).
  - *FINORA Design*: Short, indexed PostgreSQL queries and atomic RPC calls; no long-running background workers.
- **Vercel Cron Jobs**: Hobby allows up to **2 cron jobs**, triggered at most **once per day** (daily granularity, not per-minute).
  - *FINORA Design (Phase 6+)*: Recurring payments and alert checks combine daily Vercel Cron with **lazy on-access idempotent processing** whenever a user opens the app. FINORA does not promise real-time minute-by-minute background execution on the free tier.

## 2. Supabase Free Tier
- **PostgreSQL Storage**: **500 MB** database limit.
  - *FINORA Design*: Compact UUID/NUMERIC schema, targeted indexes, bounded audit metadata, and periodic session/rate-limit cleanup.
- **Inactivity Pausing**: Free Supabase projects automatically pause after **7 days of inactivity**.
  - *FINORA Policy*: Per strict zero-cost ethics, FINORA does **NOT** create artificial keep-alive traffic or fake pings to bypass pausing. If paused after inactivity, resume the project from the Supabase dashboard.
- **Supabase Storage**: **1 GB** total storage, **5 GB** monthly egress.
  - *FINORA Design*: Receipt uploads are optional, strictly capped at **5 MB** per file in PostgreSQL constraints (`attachments.file_size_bytes <= 5242880`).
- **Connection Pooling**: Serverless functions communicate via Supabase's HTTPS REST/RPC layer (`@supabase/supabase-js` with `persistSession: false`), preventing PostgreSQL TCP connection exhaustion.

## 3. Exchange Rates (Zero-Cost Policy)
- No paid FX API subscriptions.
- Uses configurable free providers or manual exchange rates stored in `exchange_rates`.
- Every rate preserves `source`, `effective_at`, and `fetched_at`. If a provider is unavailable, FINORA shows the last cached rate clearly labeled as outdated — never pretending an outdated or seeded rate is live.

## 4. Rate Limiting Without Redis
- Instead of paid Redis/Upstash, FINORA implements atomic fixed-window rate limiting inside PostgreSQL (`public.rate_limit_buckets` + `public.check_rate_limit()`), with an in-memory fallback for isolated tests.
