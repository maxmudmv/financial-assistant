-- ==============================================================================
-- FINORA Migration 0004: Budgets, Savings Goals, Debts, and Recurring Payments
-- ==============================================================================

-- Budgets (weekly, monthly, custom, category or workspace-wide)
CREATE TABLE public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  period_type public.budget_period NOT NULL DEFAULT 'monthly',
  amount_limit NUMERIC(20, 4) NOT NULL CHECK (amount_limit > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  start_date DATE NOT NULL,
  end_date DATE,
  alert_thresholds INT[] NOT NULL DEFAULT '{50,75,90,100}',
  is_shared BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_budgets_workspace_active ON public.budgets (workspace_id, is_active);
CREATE INDEX idx_budgets_category ON public.budgets (workspace_id, category_id);

CREATE TRIGGER trg_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Savings Goals
CREATE TABLE public.savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  linked_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  description TEXT,
  target_amount NUMERIC(20, 4) NOT NULL CHECK (target_amount > 0),
  current_amount NUMERIC(20, 4) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  deadline DATE,
  icon TEXT,
  color TEXT,
  status public.goal_status NOT NULL DEFAULT 'active',
  is_shared BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_savings_goals_workspace_status ON public.savings_goals (workspace_id, status);

CREATE TRIGGER trg_savings_goals_updated_at
  BEFORE UPDATE ON public.savings_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Savings Contributions & Withdrawals
CREATE TABLE public.savings_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL REFERENCES public.savings_goals(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount NUMERIC(20, 4) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  direction TEXT NOT NULL CHECK (direction IN ('deposit', 'withdrawal')),
  notes TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_savings_contributions_goal ON public.savings_contributions (goal_id, occurred_at DESC);
CREATE INDEX idx_savings_contributions_workspace ON public.savings_contributions (workspace_id, occurred_at DESC);

-- Debts (borrowed and lent)
CREATE TABLE public.debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  counterparty_name TEXT NOT NULL CHECK (char_length(trim(counterparty_name)) BETWEEN 1 AND 100),
  counterparty_contact TEXT,
  direction public.debt_direction NOT NULL,
  principal_amount NUMERIC(20, 4) NOT NULL CHECK (principal_amount > 0),
  remaining_amount NUMERIC(20, 4) NOT NULL CHECK (remaining_amount >= 0 AND remaining_amount <= principal_amount),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  status public.debt_status NOT NULL DEFAULT 'open',
  notes TEXT,
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_debts_workspace_status ON public.debts (workspace_id, status, due_date);

CREATE TRIGGER trg_debts_updated_at
  BEFORE UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Debt Repayments
CREATE TABLE public.debt_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  debt_id UUID NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount NUMERIC(20, 4) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_debt_payments_debt ON public.debt_payments (debt_id, paid_at DESC);

-- Serverless Recurring Payment Rules (no Redis/BullMQ)
CREATE TABLE public.recurring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  type public.transaction_type NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  target_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
  amount NUMERIC(20, 4) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  frequency public.recurrence_frequency NOT NULL,
  interval_count INT NOT NULL DEFAULT 1 CHECK (interval_count >= 1 AND interval_count <= 365),
  start_date DATE NOT NULL,
  end_date DATE,
  next_run_date DATE NOT NULL,
  requires_confirmation BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (type <> 'transfer' OR (target_account_id IS NOT NULL AND target_account_id <> account_id))
);

CREATE INDEX idx_recurring_rules_due
  ON public.recurring_rules (workspace_id, next_run_date)
  WHERE is_active = true;
CREATE INDEX idx_recurring_rules_global_due
  ON public.recurring_rules (next_run_date)
  WHERE is_active = true;

CREATE TRIGGER trg_recurring_rules_updated_at
  BEFORE UPDATE ON public.recurring_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Idempotent Recurring Executions (unique constraint prevents duplicate runs)
CREATE TABLE public.recurring_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.recurring_rules(id) ON DELETE CASCADE,
  scheduled_for DATE NOT NULL,
  status public.recurring_execution_status NOT NULL DEFAULT 'pending_confirmation',
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  executed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_id, scheduled_for)
);

CREATE INDEX idx_recurring_executions_workspace_status
  ON public.recurring_executions (workspace_id, status, scheduled_for DESC);

ALTER TABLE public.transactions
  ADD CONSTRAINT fk_transactions_recurring_execution
  FOREIGN KEY (recurring_execution_id) REFERENCES public.recurring_executions(id) ON DELETE SET NULL;

CREATE TRIGGER trg_recurring_executions_updated_at
  BEFORE UPDATE ON public.recurring_executions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
