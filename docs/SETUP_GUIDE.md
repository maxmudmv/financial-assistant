# FINORA — Configuration & Setup Guide (Phases 1–3)

## 1. Prerequisites
- Node.js 20+
- Free GitHub account
- Free Supabase account (https://supabase.com)
- Free Vercel Hobby account (https://vercel.com)
- Telegram Bot created via `@BotFather`

## 2. Supabase Database Setup
1. Create a new Supabase Free project.
2. Open **SQL Editor** (or use Supabase CLI) and execute migrations in exact order:
   1. `supabase/migrations/0001_extensions_and_types.sql`
   2. `supabase/migrations/0002_identity_and_workspaces.sql`
   3. `supabase/migrations/0003_core_financial_ledger.sql`
   4. `supabase/migrations/0004_planning_debts_recurring.sql`
   5. `supabase/migrations/0005_notifications_security_audit.sql`
   6. `supabase/migrations/0006_rls_and_security_policies.sql`
   7. `supabase/migrations/0007_bootstrap_user_rpc.sql`
   8. `supabase/migrations/0008_financial_engine_rpcs.sql`
3. Optionally run `supabase/seed.sql` to populate baseline `manual_seed` exchange rates.
4. Run `supabase/tests/rls_isolation.sql` in SQL Editor to verify live PostgreSQL RLS isolation (rolls back cleanly).

## 3. Telegram Bot Setup
1. Message `@BotFather` on Telegram and run `/newbot`.
2. Save the bot token as `TELEGRAM_BOT_TOKEN` (server environment variable ONLY — never commit it).
3. After deploying to Vercel, configure the Mini App URL in `@BotFather` via `/newapp` or `/setmenubutton`.

## 4. Environment Variables
Copy `.env.example` to `.env.local` for local development and set the server variables in **Vercel -> Project Settings -> Environment Variables**:

| Variable | Scope | Description |
| :--- | :--- | :--- |
| `VITE_APP_NAME` | Public | Display name (`FINORA`) |
| `VITE_TELEGRAM_BOT_USERNAME` | Public | Bot username without `@` |
| `SUPABASE_URL` | Server-only | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | Service role key (NEVER expose to browser) |
| `TELEGRAM_BOT_TOKEN` | Server-only | BotFather token for `initData` HMAC verification |
| `SESSION_SECRET` | Server-only | 32+ byte random hex secret for session hashing |
| `SESSION_TTL_SECONDS` | Server-only | Session lifetime in seconds (default `604800`) |
| `TELEGRAM_AUTH_MAX_AGE_SECONDS` | Server-only | Max `initData` age in seconds (default `300`) |
| `APP_URL` | Server-only | Production Vercel URL for strict CORS allowlist |
