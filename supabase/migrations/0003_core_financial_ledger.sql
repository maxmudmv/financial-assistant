-- ==============================================================================
-- FINORA Migration 0003: Accounts, Categories, Exchange Rates, Transactions,
-- Transfers, Immutable Ledger Entries, and Receipt Attachments
-- All monetary quantities use PostgreSQL NUMERIC(20, 4) — never floating point.
-- ==============================================================================

-- Financial Accounts
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  type public.account_type NOT NULL DEFAULT 'cash',
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  opening_balance NUMERIC(20, 4) NOT NULL DEFAULT 0,
  current_balance NUMERIC(20, 4) NOT NULL DEFAULT 0,
  visibility public.account_visibility NOT NULL DEFAULT 'workspace',
  allowed_member_ids UUID[] NOT NULL DEFAULT '{}',
  color TEXT,
  icon TEXT,
  include_in_net_worth BOOLEAN NOT NULL DEFAULT true,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_workspace ON public.accounts (workspace_id, is_archived);
CREATE INDEX idx_accounts_owner ON public.accounts (owner_user_id);

CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Transaction Categories (multilingual support for default categories)
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  name_uz TEXT,
  name_ru TEXT,
  name_en TEXT,
  type public.category_type NOT NULL,
  icon TEXT,
  color TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_workspace_type ON public.categories (workspace_id, type, is_archived);

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Exchange Rates (global cached free-provider rates + workspace manual overrides)
CREATE TABLE public.exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  base_currency CHAR(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency CHAR(3) NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  rate NUMERIC(20, 8) NOT NULL CHECK (rate > 0),
  source TEXT NOT NULL,
  is_manual BOOLEAN NOT NULL DEFAULT false,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (base_currency <> quote_currency)
);

CREATE INDEX idx_exchange_rates_pair_latest
  ON public.exchange_rates (base_currency, quote_currency, effective_at DESC);
CREATE INDEX idx_exchange_rates_workspace_pair
  ON public.exchange_rates (workspace_id, base_currency, quote_currency, effective_at DESC)
  WHERE workspace_id IS NOT NULL;

-- Transactions (preserves original amount/currency and historical reporting snapshot)
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  type public.transaction_type NOT NULL,
  status public.transaction_status NOT NULL DEFAULT 'posted',
  amount NUMERIC(20, 4) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reporting_currency CHAR(3) CHECK (reporting_currency IS NULL OR reporting_currency ~ '^[A-Z]{3}$'),
  exchange_rate_used NUMERIC(20, 8) CHECK (exchange_rate_used IS NULL OR exchange_rate_used > 0),
  reporting_amount NUMERIC(20, 4),
  exchange_rate_id UUID REFERENCES public.exchange_rates(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT,
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_private BOOLEAN NOT NULL DEFAULT false,
  reversed_transaction_id UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  transfer_id UUID,
  recurring_execution_id UUID,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_workspace_occurred
  ON public.transactions (workspace_id, occurred_at DESC);
CREATE INDEX idx_transactions_account_occurred
  ON public.transactions (account_id, occurred_at DESC);
CREATE INDEX idx_transactions_category
  ON public.transactions (workspace_id, category_id, occurred_at DESC);
CREATE INDEX idx_transactions_type_status
  ON public.transactions (workspace_id, type, status, occurred_at DESC);
CREATE INDEX idx_transactions_tags_gin
  ON public.transactions USING GIN (tags);
CREATE UNIQUE INDEX idx_transactions_idempotency
  ON public.transactions (workspace_id, created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Account-to-Account Transfers (never counted as income or expense)
CREATE TABLE public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  from_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  to_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  from_amount NUMERIC(20, 4) NOT NULL CHECK (from_amount > 0),
  from_currency CHAR(3) NOT NULL CHECK (from_currency ~ '^[A-Z]{3}$'),
  to_amount NUMERIC(20, 4) NOT NULL CHECK (to_amount > 0),
  to_currency CHAR(3) NOT NULL CHECK (to_currency ~ '^[A-Z]{3}$'),
  exchange_rate NUMERIC(20, 8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  fee_amount NUMERIC(20, 4) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  fee_currency CHAR(3) CHECK (fee_currency IS NULL OR fee_currency ~ '^[A-Z]{3}$'),
  outgoing_transaction_id UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  incoming_transaction_id UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  status public.transaction_status NOT NULL DEFAULT 'posted',
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_account_id <> to_account_id)
);

CREATE INDEX idx_transfers_workspace_occurred ON public.transfers (workspace_id, occurred_at DESC);
CREATE UNIQUE INDEX idx_transfers_idempotency
  ON public.transfers (workspace_id, created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.transactions
  ADD CONSTRAINT fk_transactions_transfer
  FOREIGN KEY (transfer_id) REFERENCES public.transfers(id) ON DELETE SET NULL;

CREATE TRIGGER trg_transfers_updated_at
  BEFORE UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Immutable Ledger Entries (append-only source of truth for balance reconciliation)
CREATE TABLE public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  entry_group_id UUID NOT NULL,
  direction public.ledger_direction NOT NULL,
  amount NUMERIC(20, 4) NOT NULL CHECK (amount > 0),
  signed_amount NUMERIC(20, 4) NOT NULL CHECK (
    (direction = 'credit' AND signed_amount = amount) OR
    (direction = 'debit' AND signed_amount = -amount)
  ),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  balance_after NUMERIC(20, 4) NOT NULL,
  is_reversal BOOLEAN NOT NULL DEFAULT false,
  reversed_entry_id UUID REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_entries_account_created ON public.ledger_entries (account_id, created_at DESC);
CREATE INDEX idx_ledger_entries_workspace_occurred ON public.ledger_entries (workspace_id, occurred_at DESC);
CREATE INDEX idx_ledger_entries_transaction ON public.ledger_entries (transaction_id);
CREATE INDEX idx_ledger_entries_group ON public.ledger_entries (entry_group_id);

-- Enforce strict ledger immutability at the database engine level
CREATE TRIGGER trg_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_record_mutation();

-- Receipt & Document Attachments (Supabase Storage Free Tier, capped at 5 MB per file)
CREATE TABLE public.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  storage_bucket TEXT NOT NULL DEFAULT 'receipts',
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880),
  checksum_sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_workspace ON public.attachments (workspace_id, created_at DESC);
CREATE INDEX idx_attachments_transaction ON public.attachments (transaction_id);
