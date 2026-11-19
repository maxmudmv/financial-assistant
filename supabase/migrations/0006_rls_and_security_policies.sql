-- ==============================================================================
-- FINORA Migration 0006: Row Level Security (RLS) & Workspace Isolation Policies
-- Enforces strict tenant/workspace isolation, role-based permissions, and
-- private transaction/account confidentiality at the PostgreSQL layer.
-- ==============================================================================

-- Resolves current user UUID from transaction-local session context or Supabase JWT
CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_setting TEXT;
BEGIN
  v_setting := NULLIF(current_setting('app.current_user_id', true), '');
  IF v_setting IS NOT NULL THEN
    RETURN v_setting::UUID;
  END IF;

  BEGIN
    RETURN auth.uid();
  EXCEPTION
    WHEN undefined_function OR invalid_schema_name THEN
      RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = public.app_current_user_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_role(
  p_workspace_id UUID,
  p_roles public.workspace_role[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = public.app_current_user_id()
      AND wm.role = ANY(p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_account(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = p_account_id
      AND public.is_workspace_member(a.workspace_id)
      AND (
        a.visibility = 'workspace'
        OR a.owner_user_id = public.app_current_user_id()
        OR (
          a.visibility = 'selected_members'
          AND public.app_current_user_id() = ANY(a.allowed_member_ids)
        )
      )
  );
$$;

-- Enable RLS across ALL tables (defense in depth)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 1. Identity & Settings Policies
-- ------------------------------------------------------------------------------
CREATE POLICY users_select_self_or_coworker ON public.users
  FOR SELECT USING (
    id = public.app_current_user_id()
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members wm_self
      JOIN public.workspace_members wm_other ON wm_self.workspace_id = wm_other.workspace_id
      WHERE wm_self.user_id = public.app_current_user_id()
        AND wm_other.user_id = public.users.id
    )
  );

CREATE POLICY users_update_self ON public.users
  FOR UPDATE USING (id = public.app_current_user_id())
  WITH CHECK (id = public.app_current_user_id());

CREATE POLICY user_settings_self_all ON public.user_settings
  FOR ALL USING (user_id = public.app_current_user_id())
  WITH CHECK (user_id = public.app_current_user_id());

CREATE POLICY sessions_self_select ON public.sessions
  FOR SELECT USING (user_id = public.app_current_user_id());

CREATE POLICY sessions_self_delete ON public.sessions
  FOR DELETE USING (user_id = public.app_current_user_id());

-- ------------------------------------------------------------------------------
-- 2. Workspaces, Members & Invitations
-- ------------------------------------------------------------------------------
CREATE POLICY workspaces_select_member ON public.workspaces
  FOR SELECT USING (public.is_workspace_member(id));

CREATE POLICY workspaces_insert_owner ON public.workspaces
  FOR INSERT WITH CHECK (owner_user_id = public.app_current_user_id());

CREATE POLICY workspaces_update_admin ON public.workspaces
  FOR UPDATE USING (public.has_workspace_role(id, ARRAY['owner', 'admin']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(id, ARRAY['owner', 'admin']::public.workspace_role[]));

CREATE POLICY workspaces_delete_owner ON public.workspaces
  FOR DELETE USING (owner_user_id = public.app_current_user_id());

CREATE POLICY workspace_members_select_member ON public.workspace_members
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY workspace_members_manage_admin ON public.workspace_members
  FOR ALL USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[]));

CREATE POLICY workspace_invitations_select_admin ON public.workspace_invitations
  FOR SELECT USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[]));

CREATE POLICY workspace_invitations_manage_admin ON public.workspace_invitations
  FOR ALL USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[]));

-- ------------------------------------------------------------------------------
-- 3. Accounts, Categories, Exchange Rates
-- ------------------------------------------------------------------------------
CREATE POLICY accounts_select_accessible ON public.accounts
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND (
      visibility = 'workspace'
      OR owner_user_id = public.app_current_user_id()
      OR (visibility = 'selected_members' AND public.app_current_user_id() = ANY(allowed_member_ids))
    )
  );

CREATE POLICY accounts_insert_writer ON public.accounts
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
    AND owner_user_id = public.app_current_user_id()
  );

CREATE POLICY accounts_update_owner_or_admin ON public.accounts
  FOR UPDATE USING (
    owner_user_id = public.app_current_user_id()
    OR (
      visibility <> 'private'
      AND public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[])
    )
  );

CREATE POLICY categories_select_member ON public.categories
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY categories_mutate_writer ON public.categories
  FOR ALL USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]));

CREATE POLICY exchange_rates_select_global_or_member ON public.exchange_rates
  FOR SELECT USING (workspace_id IS NULL OR public.is_workspace_member(workspace_id));

CREATE POLICY exchange_rates_insert_manual_member ON public.exchange_rates
  FOR INSERT WITH CHECK (
    workspace_id IS NOT NULL
    AND is_manual = true
    AND public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
  );

-- ------------------------------------------------------------------------------
-- 4. Transactions, Transfers, Immutable Ledger Entries, Attachments
-- ------------------------------------------------------------------------------
CREATE POLICY transactions_select_isolated ON public.transactions
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND public.can_access_account(account_id)
    AND (is_private = false OR created_by = public.app_current_user_id())
  );

CREATE POLICY transactions_insert_writer ON public.transactions
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
    AND public.can_access_account(account_id)
    AND created_by = public.app_current_user_id()
  );

CREATE POLICY transactions_update_creator_or_admin ON public.transactions
  FOR UPDATE USING (
    public.is_workspace_member(workspace_id)
    AND (
      created_by = public.app_current_user_id()
      OR (
        is_private = false
        AND public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[])
      )
    )
  );

-- Ledger entries are SELECT + INSERT only (append-only, immutable)
CREATE POLICY ledger_entries_select_isolated ON public.ledger_entries
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND public.can_access_account(account_id)
    AND EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = public.ledger_entries.transaction_id
        AND (t.is_private = false OR t.created_by = public.app_current_user_id())
    )
  );

CREATE POLICY ledger_entries_insert_writer ON public.ledger_entries
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
    AND created_by = public.app_current_user_id()
  );

CREATE POLICY transfers_select_isolated ON public.transfers
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND public.can_access_account(from_account_id)
    AND public.can_access_account(to_account_id)
  );

CREATE POLICY transfers_insert_writer ON public.transfers
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
    AND public.can_access_account(from_account_id)
    AND public.can_access_account(to_account_id)
    AND created_by = public.app_current_user_id()
  );

CREATE POLICY attachments_select_isolated ON public.attachments
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND (
      transaction_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.id = public.attachments.transaction_id
          AND (t.is_private = false OR t.created_by = public.app_current_user_id())
      )
    )
  );

CREATE POLICY attachments_insert_writer ON public.attachments
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
    AND uploaded_by = public.app_current_user_id()
  );

CREATE POLICY attachments_delete_uploader_or_admin ON public.attachments
  FOR DELETE USING (
    uploaded_by = public.app_current_user_id()
    OR public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[])
  );

-- ------------------------------------------------------------------------------
-- 5. Budgets, Savings Goals, Debts, Recurring Rules
-- ------------------------------------------------------------------------------
CREATE POLICY budgets_select_member ON public.budgets
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND (is_shared = true OR created_by = public.app_current_user_id())
  );

CREATE POLICY budgets_mutate_writer ON public.budgets
  FOR ALL USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]));

CREATE POLICY savings_goals_select_member ON public.savings_goals
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND (is_shared = true OR created_by = public.app_current_user_id())
  );

CREATE POLICY savings_goals_mutate_writer ON public.savings_goals
  FOR ALL USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]));

CREATE POLICY savings_contributions_select_member ON public.savings_contributions
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.savings_goals g
      WHERE g.id = public.savings_contributions.goal_id
        AND (g.is_shared = true OR g.created_by = public.app_current_user_id())
    )
  );

CREATE POLICY savings_contributions_insert_writer ON public.savings_contributions
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
    AND created_by = public.app_current_user_id()
  );

CREATE POLICY debts_select_isolated ON public.debts
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND (is_private = false OR created_by = public.app_current_user_id())
  );

CREATE POLICY debts_mutate_writer ON public.debts
  FOR ALL USING (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
    AND (is_private = false OR created_by = public.app_current_user_id())
  )
  WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
  );

CREATE POLICY debt_payments_select_isolated ON public.debt_payments
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.debts d
      WHERE d.id = public.debt_payments.debt_id
        AND (d.is_private = false OR d.created_by = public.app_current_user_id())
    )
  );

CREATE POLICY debt_payments_insert_writer ON public.debt_payments
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[])
    AND created_by = public.app_current_user_id()
  );

CREATE POLICY recurring_rules_select_member ON public.recurring_rules
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY recurring_rules_mutate_writer ON public.recurring_rules
  FOR ALL USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]));

CREATE POLICY recurring_executions_select_member ON public.recurring_executions
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY recurring_executions_mutate_writer ON public.recurring_executions
  FOR ALL USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]))
  WITH CHECK (public.has_workspace_role(workspace_id, ARRAY['owner', 'admin', 'member']::public.workspace_role[]));

-- ------------------------------------------------------------------------------
-- 6. Notifications, Audit Logs, Idempotency Keys
-- ------------------------------------------------------------------------------
CREATE POLICY notifications_self_select ON public.notifications
  FOR SELECT USING (user_id = public.app_current_user_id());

CREATE POLICY notifications_self_update ON public.notifications
  FOR UPDATE USING (user_id = public.app_current_user_id())
  WITH CHECK (user_id = public.app_current_user_id());

CREATE POLICY notification_preferences_self_all ON public.notification_preferences
  FOR ALL USING (user_id = public.app_current_user_id())
  WITH CHECK (user_id = public.app_current_user_id());

-- Audit logs: readable by workspace owner/admin or the actor themselves; never updatable/deletable
CREATE POLICY audit_logs_select_authorized ON public.audit_logs
  FOR SELECT USING (
    actor_user_id = public.app_current_user_id()
    OR (
      workspace_id IS NOT NULL
      AND public.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::public.workspace_role[])
    )
  );

CREATE POLICY idempotency_keys_self_all ON public.idempotency_keys
  FOR ALL USING (user_id = public.app_current_user_id())
  WITH CHECK (user_id = public.app_current_user_id());

-- Note: rate_limit_buckets intentionally has zero user policies; only SECURITY DEFINER
-- check_rate_limit() or the server-side service role can access it.

-- Ensure Supabase's backend-only `service_role` has explicit privileges on all schema objects
-- (required on newer Supabase projects where default table grants are restricted).
-- `anon` intentionally receives NO table grants because FINORA serves all data via Vercel API.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO service_role';
    EXECUTE 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role';
    EXECUTE 'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role';
  END IF;
END
$$;
