# FINORA — Security & Financial Integrity Architecture

## 1. Telegram Authentication (Zero-Trust)
1. The frontend passes raw `window.Telegram.WebApp.initData` to `POST /api/auth/telegram`.
2. The backend NEVER trusts standalone user IDs sent from the client.
3. `server/auth/telegram.ts` computes:
   - `secret_key = HMAC_SHA256("WebAppData", TELEGRAM_BOT_TOKEN)`
   - `expected_hash = hex(HMAC_SHA256(secret_key, sorted_data_check_string))`
4. Comparison uses `crypto.timingSafeEqual` to eliminate timing side-channels.
5. `auth_date` is strictly validated against replay (`TELEGRAM_AUTH_MAX_AGE_SECONDS`, default 300s) and future clock skew (60s). Bot accounts (`is_bot: true`) are rejected.
6. `TELEGRAM_BOT_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` exist exclusively in Vercel server environment variables and are never prefixed with `VITE_`.

## 2. Session Management
- Sessions use 256-bit cryptographically random opaque tokens (`crypto.randomBytes(32)`).
- Only `HMAC_SHA256(SESSION_SECRET, rawToken)` is stored in `public.sessions.token_hash`.
- Delivered via `HttpOnly; Secure; SameSite=None; Path=/` cookie in production HTTPS (required for Telegram WebViews), with an in-memory `Authorization: Bearer` fallback (never stored in `localStorage`).
- Logout immediately marks `sessions.revoked_at = now()` and clears the cookie.

## 3. PostgreSQL Row Level Security (RLS) & Immutability
- **RLS is enabled on all 25 tables** in `supabase/migrations/0006_rls_and_security_policies.sql`.
- Workspace isolation is enforced both in backend authorization guards (`requireWorkspaceAccess`) and at the PostgreSQL policy layer (`is_workspace_member`, `has_workspace_role`, `can_access_account`).
- Private transactions (`transactions.is_private = true`) and private accounts (`accounts.visibility = 'private'`) are restricted to their owner/creator.
- `ledger_entries` and `audit_logs` are protected by `BEFORE UPDATE OR DELETE` database triggers (`prevent_record_mutation`) making posted financial ledger and audit trails immutable.

## 4. Monetary Precision
- All monetary columns use `NUMERIC(20, 4)` and exchange rates use `NUMERIC(20, 8)`.
- Floating-point SQL types (`FLOAT`, `REAL`, `DOUBLE PRECISION`) are prohibited and guarded by automated schema tests (`tests/db/schema.test.ts`).
- Frontend/backend decimal calculations use `decimal.js`.

## 5. Security Hardening Audit Controls
- **Fail-Closed Cron Protection**: `/api/recurring/cron` requires `CRON_SECRET` (`>= 16` chars) verified via `crypto.timingSafeEqual`; if unset, requests are rejected with `401`.
- **Private Entity Confidentiality**: Private transactions, private accounts, non-shared savings goals, private debts, and their history/repayment endpoints enforce creator ownership at both API and PostgreSQL RLS layers. Budget totals strictly exclude other members' private expenses.
- **Invitation Hardening**: Accepting family invitations is rate-limited (`10 req/min`), verifies `invitee_telegram_username` when scoped, prevents duplicate membership or owner role downgrade, and records audit logs.
- **Strict CSP**: Browser `connect-src` is locked to `'self'` so the client communicates exclusively with same-origin Vercel Serverless APIs and never touches Supabase directly.
