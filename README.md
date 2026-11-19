# FINORA — Zero-Cost Personal & Family Finance Telegram Mini App

FINORA is a zero-cost, serverless-first personal and family financial management Telegram Mini App designed to run exclusively on **Vercel Hobby (Free)**, **Supabase Free (PostgreSQL + RLS)**, **GitHub Free**, and the **Telegram Bot API**.

## Implementation Status

- [x] **Phase 1**: Project initialization, serverless-first architecture, Liquid Glass design system foundation, multilingual foundation (`uz` default, `ru`, `en`).
- [x] **Phase 2**: Complete PostgreSQL schema (23 domain tables + 2 security tables), decimal-safe `NUMERIC(20,4)` columns, immutable `ledger_entries` & `audit_logs` triggers, Row Level Security (RLS) policies, atomic `bootstrap_telegram_user` RPC, seed data, and SQL RLS isolation test.
- [x] **Phase 3**: Server-side Telegram Mini App `initData` HMAC-SHA256 verification, constant-time signature validation, `auth_date` freshness checks, hashed database sessions (`HttpOnly` cookie + in-memory Bearer fallback for Telegram WebView), workspace RBAC authorization guards, PostgreSQL-backed rate limiting, and audit logging.
- [x] **Phase 4**: Atomic PostgreSQL financial engine RPCs (`0008_financial_engine_rpcs.sql`), decimal-safe accounting (`decimal.js` + `NUMERIC(20,4)`), immutable append-only ledger & reversals, accounts CRUD + reconciliation, full transactions CRUD (search/filter/sort/edit/void/idempotency), balanced same-currency & cross-currency transfers, and zero-cost multi-currency exchange rates (free provider cache + manual overrides + honest outdated labeling).
- [x] **Phase 5–9**: Responsive Apple Liquid Glass UI (Dark/Light/System), Dashboard with period selectors & workspace switching, Analytics with all 8 metrics & all 9 interactive Recharts visualizations, Budgets (monthly/weekly/custom + 50/75/90/100% deduplicated alerts), Savings Goals (presets, edit, deposit/withdraw, history), Debts (borrowed/lent, partial/full repay, history), serverless Recurring Payments (lazy + daily Vercel Cron + confirmation flow), Family Workspace RBAC & tokenized invites, Telegram notifications, and all 7 Reports with on-demand binary **PDF**, **XLSX**, and **CSV** export.
- [x] **Phase 10**: Complete security review & hardening, end-to-end automated test suite, free-tier quota verification, code-split production build, and [Vercel Deployment Guide](docs/DEPLOYMENT_GUIDE.md).

## Repository Layout

```text
finora/
├── api/                    # Thin Vercel Serverless Function entrypoints (<= 12 on Hobby)
│   ├── health.ts           # GET /api/health
│   └── auth/index.ts       # /api/auth/{telegram,session,switch-workspace,logout}
├── server/                 # Server-only backend modules (never bundled into frontend)
│   ├── auth/               # Telegram HMAC verification & session/RBAC management
│   ├── config/             # Zod-validated server environment variables
│   ├── db/                 # Supabase service-role client (server-only)
│   ├── http/               # Safe API handler wrapper & JSON response helpers
│   └── security/           # Typed errors, CORS/security headers, rate limiting, audit logs
├── src/                    # React + TypeScript + Vite + Tailwind Liquid Glass SPA
│   ├── components/glass/   # Frosted Liquid Glass primitives
│   ├── contexts/           # AuthContext & ThemeContext (Dark/Light/System)
│   ├── i18n/               # Multilingual dictionaries (uz default, ru, en) & formatters
│   ├── layouts/            # Responsive shell layout
│   ├── lib/                # Telegram WebApp SDK adapter & API client
│   ├── pages/              # AuthGatePage & FoundationShellPage
│   ├── services/           # Typed REST API service layer
│   ├── styles/             # Liquid Glass CSS tokens & progressive backdrop-filter fallbacks
│   └── types/              # Frontend domain TypeScript types
├── supabase/
│   ├── migrations/         # Ordered SQL migrations (0001..0007)
│   ├── seed.sql            # Baseline clearly labeled manual_seed exchange rates
│   └── tests/              # PostgreSQL RLS isolation test script
├── tests/                  # Automated Vitest unit, security, schema, and UI tests
└── docs/                   # Free-tier limits, security architecture, setup guide
```

## Quick Commands

```bash
npm install
npm run typecheck
npm test
npm run build
```

See [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md), [docs/FREE_TIER_LIMITS.md](docs/FREE_TIER_LIMITS.md), and [docs/SECURITY.md](docs/SECURITY.md) for full configuration and security details.
