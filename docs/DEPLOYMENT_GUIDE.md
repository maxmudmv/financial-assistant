# FINORA — Zero-Cost Production Deployment Guide (Vercel Hobby + Supabase Free)

This guide walks through deploying FINORA at **$0/month** using **GitHub Free**, **Supabase Free**, **Vercel Hobby**, and **Telegram Bot API**.

> **Important**: Never commit `.env.local` or real secrets to GitHub. Configure all server secrets strictly inside Vercel Environment Variables.

---

## Step 1: GitHub Repository Setup (Free)
1. Create a new private or public repository on [GitHub](https://github.com/new) named `finora`.
2. Initialize Git locally inside `c:\Finora` and push your code:
   ```bash
   git init
   git add .
   git commit -m "Initial FINORA zero-cost production build"
   git branch -M main
   git remote add origin https://github.com/<your-username>/finora.git
   git push -u origin main
   ```
3. Confirm `.gitignore` excludes `.env*`, `node_modules/`, and `dist/`.

---

## Step 2: Supabase Project Setup (Free Tier)
1. Sign in to [Supabase](https://supabase.com) and click **New Project**.
2. Choose the **Free** plan, pick the region closest to your users, and set a strong database password.
3. Once provisioned, open **Project Settings → API** and record (do not share publicly):
   - **Project URL** → `SUPABASE_URL`
   - **service_role secret key** → `SUPABASE_SERVICE_ROLE_KEY` (server-only!)

> **Free-Tier Note**: Supabase Free pauses inactive projects after **7 days** of zero activity. FINORA intentionally does **not** run artificial keep-alive pings. If paused, click **Restore Project** in the Supabase dashboard.

---

## Step 3: Database Migration & RLS Verification
Open **Supabase Dashboard → SQL Editor** and execute each migration file in exact numerical order:

1. `supabase/migrations/0001_extensions_and_types.sql`
2. `supabase/migrations/0002_identity_and_workspaces.sql`
3. `supabase/migrations/0003_core_financial_ledger.sql`
4. `supabase/migrations/0004_planning_debts_recurring.sql`
5. `supabase/migrations/0005_notifications_security_audit.sql`
6. `supabase/migrations/0006_rls_and_security_policies.sql`
7. `supabase/migrations/0007_bootstrap_user_rpc.sql`
8. `supabase/migrations/0008_financial_engine_rpcs.sql`

Then:
- Run `supabase/seed.sql` to populate clearly labeled `manual_seed` baseline exchange rates (`UZS`, `USD`, `EUR`, `RUB`, `GBP`).
- Run `supabase/tests/rls_isolation.sql` to verify live cross-workspace RLS isolation (runs inside `BEGIN ... ROLLBACK`, leaving zero test rows behind). Confirm the notice: `RLS ISOLATION PASSED`.

---

## Step 4: Telegram Bot Creation (Free)
1. Open Telegram and start a chat with `@BotFather`.
2. Run `/newbot`, provide a display name (e.g., `FINORA Finance`) and a username ending in `bot` (e.g., `my_finora_bot`).
3. Copy the HTTP API token issued by `@BotFather` → `TELEGRAM_BOT_TOKEN` (server-only!).
4. Save the bot username without `@` → `VITE_TELEGRAM_BOT_USERNAME`.

---

## Step 5: Environment Variable Configuration
Generate two cryptographically strong random secrets locally:
```bash
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

Prepare the following variables for **Vercel → Project Settings → Environment Variables** (Production & Preview):

| Variable | Visibility | Required | Description |
| :--- | :--- | :---: | :--- |
| `VITE_APP_NAME` | Browser (Public) | Optional | App display name (`FINORA`) |
| `VITE_TELEGRAM_BOT_USERNAME` | Browser (Public) | Yes | Bot username without `@` |
| `SUPABASE_URL` | Server-only | Yes | Supabase project HTTPS URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | Yes | Supabase `service_role` key (NEVER prefix with `VITE_`) |
| `TELEGRAM_BOT_TOKEN` | Server-only | Yes | BotFather API token for HMAC-SHA256 `initData` verification |
| `SESSION_SECRET` | Server-only | Yes | Random hex string (`>= 32` chars) for HMAC session token hashing |
| `CRON_SECRET` | Server-only | Yes | Random hex string (`>= 16` chars) protecting `/api/recurring/cron` (fail-closed) |
| `APP_URL` | Server-only | Yes | Deployed Vercel URL (e.g., `https://finora.vercel.app`) for strict CORS |
| `SESSION_TTL_SECONDS` | Server-only | Optional | Session lifetime in seconds (default `604800` = 7 days) |
| `TELEGRAM_AUTH_MAX_AGE_SECONDS` | Server-only | Optional | Max Telegram `initData` age in seconds (default `300`) |
| `EXCHANGE_RATE_PROVIDER_URL` | Server-only | Optional | Free FX endpoint (default `https://open.er-api.com/v6/latest/USD`) |

---

## Step 6: Vercel Project Import (Hobby Free Plan)
1. Sign in to [Vercel](https://vercel.com) with your GitHub account on the **Hobby (Free)** plan.
2. Click **Add New → Project** and import your `finora` repository.
3. Verify build settings (auto-detected from `vercel.json`):
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Add all environment variables from Step 5 before clicking **Deploy**.

### Verified Vercel Hobby Free-Tier Compatibility
- **Serverless Functions**: Exactly **12** files under `api/` (Hobby cap: 12).
- **Execution Timeout**: `maxDuration: 10` seconds (Hobby cap: 10s).
- **Vercel Cron**: **1** daily cron (`0 6 * * *` on `/api/recurring/cron`) paired with lazy on-access recurring execution (Hobby cap: 2 daily crons).
- **Zero Paid Services**: No VPS, Redis, BullMQ, NestJS, or paid FX APIs.

---

## Step 7: Deployment & Post-Deploy Smoke Checks
1. Click **Deploy** in Vercel and wait for the production URL (e.g., `https://finora-xyz.vercel.app`).
2. Update `APP_URL` in Vercel Environment Variables to match your final `https://...vercel.app` URL and redeploy once.
3. Verify health endpoint:
   ```bash
   curl https://<your-app>.vercel.app/api/health
   ```
   Confirm response shows `"status": "ok"` and all three readiness booleans are `true` (`supabaseConfigured`, `telegramConfigured`, `sessionConfigured`).
4. Confirm unauthorized API protection:
   - `GET /api/auth/session` without cookies returns `401 UNAUTHORIZED`.
   - `GET /api/recurring/cron` without `Authorization: Bearer <CRON_SECRET>` returns `401 UNAUTHORIZED`.

---

## Step 8: Telegram Mini App Configuration
1. Return to `@BotFather` in Telegram.
2. Set the bot Menu Button to launch your Mini App:
   - Send `/setmenubutton` → select your bot → paste `https://<your-app>.vercel.app` → set button text (e.g., `Open FINORA`).
3. Optionally register a named Mini App via `/newapp` pointing to `https://<your-app>.vercel.app`.
4. Open your bot in Telegram (mobile or desktop) and tap the Menu Button:
   - FINORA automatically verifies your cryptographic Telegram `initData` on `/api/auth/telegram`.
   - Your Personal workspace, starter Cash account, and multilingual categories (`UZ`/`RU`/`EN`) are provisioned atomically on first launch.
   - Verify creating an account, posting income/expense, transferring funds, running **Ledger Reconciliation**, viewing **Analytics**, and downloading a **PDF/XLSX/CSV** report.
