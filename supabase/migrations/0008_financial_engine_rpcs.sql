-- ==============================================================================
-- FINORA Migration 0008: Atomic PostgreSQL Financial Engine RPCs
-- Guarantees ACID atomicity, row-level locking (FOR UPDATE), decimal precision
-- (NUMERIC(20,4) / NUMERIC(20,8)), idempotency, immutable append-only ledger
-- reversals, deadlock-free transfer locking, and deterministic reconciliation.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Atomic Transaction Posting (Income, Expense, Refund, Adjustment, etc.)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_transaction_atomic(
  p_workspace_id UUID,
  p_account_id UUID,
  p_category_id UUID,
  p_created_by UUID,
  p_type public.transaction_type,
  p_amount NUMERIC(20, 4),
  p_reporting_currency CHAR(3),
  p_exchange_rate_used NUMERIC(20, 8),
  p_reporting_amount NUMERIC(20, 4),
  p_exchange_rate_id UUID,
  p_occurred_at TIMESTAMPTZ,
  p_description TEXT,
  p_notes TEXT,
  p_tags TEXT[],
  p_is_private BOOLEAN,
  p_idempotency_key TEXT,
  p_adjustment_direction public.ledger_direction DEFAULT 'credit'
)
RETURNS TABLE (
  transaction_id UUID,
  ledger_entry_id UUID,
  account_currency CHAR(3),
  new_balance NUMERIC(20, 4),
  is_duplicate BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_existing_tx RECORD;
  v_account RECORD;
  v_direction public.ledger_direction;
  v_signed_amount NUMERIC(20, 4);
  v_new_balance NUMERIC(20, 4);
  v_tx_id UUID;
  v_entry_id UUID;
  v_group_id UUID := gen_random_uuid();
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transaction amount must be strictly positive' USING ERRCODE = 'check_violation';
  END IF;

  IF p_type = 'transfer' THEN
    RAISE EXCEPTION 'Use post_transfer_atomic for internal transfers' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Idempotency check before mutating state
  IF p_idempotency_key IS NOT NULL AND char_length(trim(p_idempotency_key)) > 0 THEN
    SELECT t.id, t.account_id, t.currency
    INTO v_existing_tx
    FROM public.transactions t
    WHERE t.workspace_id = p_workspace_id
      AND t.created_by = p_created_by
      AND t.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_existing_tx.id IS NOT NULL THEN
      SELECT a.current_balance INTO v_new_balance
      FROM public.accounts a
      WHERE a.id = v_existing_tx.account_id;

      SELECT le.id INTO v_entry_id
      FROM public.ledger_entries le
      WHERE le.transaction_id = v_existing_tx.id
      ORDER BY le.created_at DESC
      LIMIT 1;

      RETURN QUERY SELECT v_existing_tx.id, v_entry_id, v_existing_tx.currency, v_new_balance, true;
      RETURN;
    END IF;
  END IF;

  -- Row-level lock on target account
  SELECT a.id, a.currency, a.current_balance, a.is_archived
  INTO v_account
  FROM public.accounts a
  WHERE a.id = p_account_id
    AND a.workspace_id = p_workspace_id
  FOR UPDATE;

  IF v_account.id IS NULL THEN
    RAISE EXCEPTION 'Account not found in workspace' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_account.is_archived THEN
    RAISE EXCEPTION 'Cannot post transactions to an archived account' USING ERRCODE = 'restrict_violation';
  END IF;

  -- Determine ledger direction
  IF p_type IN ('income', 'refund', 'savings_withdrawal') THEN
    v_direction := 'credit';
  ELSIF p_type IN ('expense', 'savings_contribution', 'debt_repayment') THEN
    v_direction := 'debit';
  ELSIF p_type = 'adjustment' THEN
    v_direction := COALESCE(p_adjustment_direction, 'credit');
  ELSE
    RAISE EXCEPTION 'Unsupported transaction type: %', p_type USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_signed_amount := CASE WHEN v_direction = 'credit' THEN p_amount ELSE -p_amount END;
  v_new_balance := v_account.current_balance + v_signed_amount;

  INSERT INTO public.transactions (
    workspace_id,
    account_id,
    category_id,
    created_by,
    type,
    status,
    amount,
    currency,
    reporting_currency,
    exchange_rate_used,
    reporting_amount,
    exchange_rate_id,
    occurred_at,
    description,
    notes,
    tags,
    is_private,
    idempotency_key
  )
  VALUES (
    p_workspace_id,
    p_account_id,
    p_category_id,
    p_created_by,
    p_type,
    'posted',
    p_amount,
    v_account.currency,
    p_reporting_currency,
    p_exchange_rate_used,
    p_reporting_amount,
    p_exchange_rate_id,
    COALESCE(p_occurred_at, now()),
    NULLIF(trim(COALESCE(p_description, '')), ''),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    COALESCE(p_tags, '{}'::TEXT[]),
    COALESCE(p_is_private, false),
    NULLIF(trim(COALESCE(p_idempotency_key, '')), '')
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO public.ledger_entries (
    workspace_id,
    transaction_id,
    account_id,
    entry_group_id,
    direction,
    amount,
    signed_amount,
    currency,
    balance_after,
    is_reversal,
    occurred_at,
    created_by
  )
  VALUES (
    p_workspace_id,
    v_tx_id,
    p_account_id,
    v_group_id,
    v_direction,
    p_amount,
    v_signed_amount,
    v_account.currency,
    v_new_balance,
    false,
    COALESCE(p_occurred_at, now()),
    p_created_by
  )
  RETURNING id INTO v_entry_id;

  UPDATE public.accounts
  SET current_balance = v_new_balance
  WHERE id = p_account_id;

  RETURN QUERY SELECT v_tx_id, v_entry_id, v_account.currency, v_new_balance, false;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Atomic Transaction Edit (Immutable Reversal + Re-post on Financial Changes)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_transaction_atomic(
  p_workspace_id UUID,
  p_transaction_id UUID,
  p_actor_user_id UUID,
  p_account_id UUID,
  p_category_id UUID,
  p_type public.transaction_type,
  p_amount NUMERIC(20, 4),
  p_reporting_currency CHAR(3),
  p_exchange_rate_used NUMERIC(20, 8),
  p_reporting_amount NUMERIC(20, 4),
  p_exchange_rate_id UUID,
  p_occurred_at TIMESTAMPTZ,
  p_description TEXT,
  p_notes TEXT,
  p_tags TEXT[],
  p_is_private BOOLEAN,
  p_adjustment_direction public.ledger_direction DEFAULT 'credit'
)
RETURNS TABLE (
  transaction_id UUID,
  new_account_balance NUMERIC(20, 4),
  ledger_reposted BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tx RECORD;
  v_last_entry RECORD;
  v_old_account RECORD;
  v_new_account RECORD;
  v_old_balance_after_rev NUMERIC(20, 4);
  v_new_direction public.ledger_direction;
  v_new_signed NUMERIC(20, 4);
  v_new_balance NUMERIC(20, 4);
  v_financial_changed BOOLEAN;
  v_group_id UUID := gen_random_uuid();
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transaction amount must be strictly positive' USING ERRCODE = 'check_violation';
  END IF;

  IF p_type = 'transfer' THEN
    RAISE EXCEPTION 'Internal transfers cannot be edited as regular transactions' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_tx
  FROM public.transactions
  WHERE id = p_transaction_id
    AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found in workspace' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_tx.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted transactions can be edited' USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_tx.type = 'transfer' THEN
    RAISE EXCEPTION 'Transfer transactions must be voided and re-created' USING ERRCODE = 'restrict_violation';
  END IF;

  -- Determine target ledger direction
  IF p_type IN ('income', 'refund', 'savings_withdrawal') THEN
    v_new_direction := 'credit';
  ELSIF p_type IN ('expense', 'savings_contribution', 'debt_repayment') THEN
    v_new_direction := 'debit';
  ELSE
    v_new_direction := COALESCE(p_adjustment_direction, 'credit');
  END IF;

  -- Fetch latest non-reversal ledger entry for this transaction
  SELECT * INTO v_last_entry
  FROM public.ledger_entries le
  WHERE le.transaction_id = v_tx.id
    AND le.is_reversal = false
  ORDER BY le.created_at DESC
  LIMIT 1;

  v_financial_changed :=
    (v_tx.account_id <> p_account_id)
    OR (v_tx.amount <> p_amount)
    OR (v_tx.type <> p_type)
    OR (v_last_entry.direction <> v_new_direction);

  IF NOT v_financial_changed THEN
    -- Metadata-only update: ledger entries remain untouched
    UPDATE public.transactions
    SET
      category_id = p_category_id,
      occurred_at = COALESCE(p_occurred_at, occurred_at),
      description = NULLIF(trim(COALESCE(p_description, '')), ''),
      notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
      tags = COALESCE(p_tags, '{}'::TEXT[]),
      is_private = COALESCE(p_is_private, is_private)
    WHERE id = v_tx.id;

    SELECT current_balance INTO v_new_balance FROM public.accounts WHERE id = v_tx.account_id;
    RETURN QUERY SELECT v_tx.id, v_new_balance, false;
    RETURN;
  END IF;

  -- Financial change: lock involved accounts in deterministic UUID order (deadlock-free)
  IF v_tx.account_id = p_account_id THEN
    SELECT * INTO v_old_account FROM public.accounts WHERE id = v_tx.account_id AND workspace_id = p_workspace_id FOR UPDATE;
    v_new_account := v_old_account;
  ELSIF v_tx.account_id < p_account_id THEN
    SELECT * INTO v_old_account FROM public.accounts WHERE id = v_tx.account_id AND workspace_id = p_workspace_id FOR UPDATE;
    SELECT * INTO v_new_account FROM public.accounts WHERE id = p_account_id AND workspace_id = p_workspace_id FOR UPDATE;
  ELSE
    SELECT * INTO v_new_account FROM public.accounts WHERE id = p_account_id AND workspace_id = p_workspace_id FOR UPDATE;
    SELECT * INTO v_old_account FROM public.accounts WHERE id = v_tx.account_id AND workspace_id = p_workspace_id FOR UPDATE;
  END IF;

  IF v_new_account.id IS NULL OR v_new_account.is_archived THEN
    RAISE EXCEPTION 'Target account is missing or archived' USING ERRCODE = 'restrict_violation';
  END IF;

  -- Step A: Insert immutable reversing ledger entry on old account
  v_old_balance_after_rev := v_old_account.current_balance - v_last_entry.signed_amount;

  INSERT INTO public.ledger_entries (
    workspace_id,
    transaction_id,
    account_id,
    entry_group_id,
    direction,
    amount,
    signed_amount,
    currency,
    balance_after,
    is_reversal,
    reversed_entry_id,
    occurred_at,
    created_by
  )
  VALUES (
    p_workspace_id,
    v_tx.id,
    v_old_account.id,
    v_group_id,
    CASE WHEN v_last_entry.direction = 'credit' THEN 'debit'::public.ledger_direction ELSE 'credit'::public.ledger_direction END,
    v_last_entry.amount,
    -v_last_entry.signed_amount,
    v_old_account.currency,
    v_old_balance_after_rev,
    true,
    v_last_entry.id,
    now(),
    p_actor_user_id
  );

  UPDATE public.accounts
  SET current_balance = v_old_balance_after_rev
  WHERE id = v_old_account.id;

  -- Step B: Insert new immutable forward ledger entry on target account
  v_new_signed := CASE WHEN v_new_direction = 'credit' THEN p_amount ELSE -p_amount END;
  v_new_balance := (CASE WHEN v_old_account.id = v_new_account.id THEN v_old_balance_after_rev ELSE v_new_account.current_balance END) + v_new_signed;

  INSERT INTO public.ledger_entries (
    workspace_id,
    transaction_id,
    account_id,
    entry_group_id,
    direction,
    amount,
    signed_amount,
    currency,
    balance_after,
    is_reversal,
    occurred_at,
    created_by
  )
  VALUES (
    p_workspace_id,
    v_tx.id,
    v_new_account.id,
    v_group_id,
    v_new_direction,
    p_amount,
    v_new_signed,
    v_new_account.currency,
    v_new_balance,
    false,
    COALESCE(p_occurred_at, v_tx.occurred_at),
    p_actor_user_id
  );

  UPDATE public.accounts
  SET current_balance = v_new_balance
  WHERE id = v_new_account.id;

  -- Step C: Update transaction record
  UPDATE public.transactions
  SET
    account_id = v_new_account.id,
    category_id = p_category_id,
    type = p_type,
    amount = p_amount,
    currency = v_new_account.currency,
    reporting_currency = p_reporting_currency,
    exchange_rate_used = p_exchange_rate_used,
    reporting_amount = p_reporting_amount,
    exchange_rate_id = p_exchange_rate_id,
    occurred_at = COALESCE(p_occurred_at, occurred_at),
    description = NULLIF(trim(COALESCE(p_description, '')), ''),
    notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
    tags = COALESCE(p_tags, '{}'::TEXT[]),
    is_private = COALESCE(p_is_private, is_private)
  WHERE id = v_tx.id;

  RETURN QUERY SELECT v_tx.id, v_new_balance, true;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Atomic Transaction Void / Reversal (Appends Reversing Ledger Entry)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_transaction_atomic(
  p_workspace_id UUID,
  p_transaction_id UUID,
  p_actor_user_id UUID
)
RETURNS TABLE (
  transaction_id UUID,
  reversal_entry_id UUID,
  new_balance NUMERIC(20, 4)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tx RECORD;
  v_last_entry RECORD;
  v_account RECORD;
  v_new_balance NUMERIC(20, 4);
  v_rev_entry_id UUID;
BEGIN
  SELECT * INTO v_tx
  FROM public.transactions
  WHERE id = p_transaction_id
    AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found in workspace' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_tx.status = 'voided' THEN
    RAISE EXCEPTION 'Transaction is already voided' USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_tx.type = 'transfer' THEN
    RAISE EXCEPTION 'Use void_transfer_atomic to void an internal transfer' USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT * INTO v_account
  FROM public.accounts
  WHERE id = v_tx.account_id
    AND workspace_id = p_workspace_id
  FOR UPDATE;

  SELECT * INTO v_last_entry
  FROM public.ledger_entries le
  WHERE le.transaction_id = v_tx.id
    AND le.is_reversal = false
  ORDER BY le.created_at DESC
  LIMIT 1;

  IF v_last_entry.id IS NULL THEN
    RAISE EXCEPTION 'Original ledger entry not found for transaction' USING ERRCODE = 'data_corrupted';
  END IF;

  v_new_balance := v_account.current_balance - v_last_entry.signed_amount;

  INSERT INTO public.ledger_entries (
    workspace_id,
    transaction_id,
    account_id,
    entry_group_id,
    direction,
    amount,
    signed_amount,
    currency,
    balance_after,
    is_reversal,
    reversed_entry_id,
    occurred_at,
    created_by
  )
  VALUES (
    p_workspace_id,
    v_tx.id,
    v_account.id,
    gen_random_uuid(),
    CASE WHEN v_last_entry.direction = 'credit' THEN 'debit'::public.ledger_direction ELSE 'credit'::public.ledger_direction END,
    v_last_entry.amount,
    -v_last_entry.signed_amount,
    v_account.currency,
    v_new_balance,
    true,
    v_last_entry.id,
    now(),
    p_actor_user_id
  )
  RETURNING id INTO v_rev_entry_id;

  UPDATE public.accounts
  SET current_balance = v_new_balance
  WHERE id = v_account.id;

  UPDATE public.transactions
  SET status = 'voided'
  WHERE id = v_tx.id;

  RETURN QUERY SELECT v_tx.id, v_rev_entry_id, v_new_balance;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Atomic Account-to-Account Transfer (Deadlock-Free Dual-Leg Posting)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_transfer_atomic(
  p_workspace_id UUID,
  p_created_by UUID,
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_from_amount NUMERIC(20, 4),
  p_to_amount NUMERIC(20, 4),
  p_exchange_rate NUMERIC(20, 8),
  p_fee_amount NUMERIC(20, 4),
  p_occurred_at TIMESTAMPTZ,
  p_notes TEXT,
  p_idempotency_key TEXT
)
RETURNS TABLE (
  transfer_id UUID,
  outgoing_transaction_id UUID,
  incoming_transaction_id UUID,
  from_new_balance NUMERIC(20, 4),
  to_new_balance NUMERIC(20, 4),
  is_duplicate BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_existing RECORD;
  v_from_acc RECORD;
  v_to_acc RECORD;
  v_from_new_bal NUMERIC(20, 4);
  v_to_new_bal NUMERIC(20, 4);
  v_after_principal NUMERIC(20, 4);
  v_out_tx_id UUID;
  v_in_tx_id UUID;
  v_transfer_id UUID;
  v_group_id UUID := gen_random_uuid();
  v_fee NUMERIC(20, 4) := COALESCE(p_fee_amount, 0);
  v_occurred TIMESTAMPTZ := COALESCE(p_occurred_at, now());
BEGIN
  IF p_from_account_id = p_to_account_id THEN
    RAISE EXCEPTION 'Source and destination accounts must be different' USING ERRCODE = 'check_violation';
  END IF;

  IF p_from_amount <= 0 OR p_to_amount <= 0 OR p_exchange_rate <= 0 OR v_fee < 0 THEN
    RAISE EXCEPTION 'Transfer amounts and exchange rate must be positive (fee >= 0)' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL AND char_length(trim(p_idempotency_key)) > 0 THEN
    SELECT * INTO v_existing
    FROM public.transfers tr
    WHERE tr.workspace_id = p_workspace_id
      AND tr.created_by = p_created_by
      AND tr.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      SELECT current_balance INTO v_from_new_bal FROM public.accounts WHERE id = v_existing.from_account_id;
      SELECT current_balance INTO v_to_new_bal FROM public.accounts WHERE id = v_existing.to_account_id;
      RETURN QUERY SELECT
        v_existing.id,
        v_existing.outgoing_transaction_id,
        v_existing.incoming_transaction_id,
        v_from_new_bal,
        v_to_new_bal,
        true;
      RETURN;
    END IF;
  END IF;

  -- Deterministic UUID lock order to prevent deadlocks
  IF p_from_account_id < p_to_account_id THEN
    SELECT * INTO v_from_acc FROM public.accounts WHERE id = p_from_account_id AND workspace_id = p_workspace_id FOR UPDATE;
    SELECT * INTO v_to_acc FROM public.accounts WHERE id = p_to_account_id AND workspace_id = p_workspace_id FOR UPDATE;
  ELSE
    SELECT * INTO v_to_acc FROM public.accounts WHERE id = p_to_account_id AND workspace_id = p_workspace_id FOR UPDATE;
    SELECT * INTO v_from_acc FROM public.accounts WHERE id = p_from_account_id AND workspace_id = p_workspace_id FOR UPDATE;
  END IF;

  IF v_from_acc.id IS NULL OR v_to_acc.id IS NULL THEN
    RAISE EXCEPTION 'One or both transfer accounts were not found in workspace' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_from_acc.is_archived OR v_to_acc.is_archived THEN
    RAISE EXCEPTION 'Cannot transfer using archived accounts' USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_from_acc.currency = v_to_acc.currency AND p_from_amount <> p_to_amount THEN
    RAISE EXCEPTION 'Same-currency transfers must have identical source and destination amounts' USING ERRCODE = 'check_violation';
  END IF;

  v_after_principal := v_from_acc.current_balance - p_from_amount;
  v_from_new_bal := v_after_principal - v_fee;
  v_to_new_bal := v_to_acc.current_balance + p_to_amount;

  -- Create outgoing leg transaction
  INSERT INTO public.transactions (
    workspace_id, account_id, created_by, type, status,
    amount, currency, occurred_at, description, notes
  )
  VALUES (
    p_workspace_id, v_from_acc.id, p_created_by, 'transfer', 'posted',
    p_from_amount, v_from_acc.currency, v_occurred,
    'Transfer to ' || v_to_acc.name,
    NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_out_tx_id;

  -- Create incoming leg transaction
  INSERT INTO public.transactions (
    workspace_id, account_id, created_by, type, status,
    amount, currency, occurred_at, description, notes
  )
  VALUES (
    p_workspace_id, v_to_acc.id, p_created_by, 'transfer', 'posted',
    p_to_amount, v_to_acc.currency, v_occurred,
    'Transfer from ' || v_from_acc.name,
    NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_in_tx_id;

  -- Create balanced transfer record
  INSERT INTO public.transfers (
    workspace_id, created_by, from_account_id, to_account_id,
    from_amount, from_currency, to_amount, to_currency,
    exchange_rate, fee_amount, fee_currency,
    outgoing_transaction_id, incoming_transaction_id,
    occurred_at, notes, status, idempotency_key
  )
  VALUES (
    p_workspace_id, p_created_by, v_from_acc.id, v_to_acc.id,
    p_from_amount, v_from_acc.currency, p_to_amount, v_to_acc.currency,
    p_exchange_rate, v_fee, CASE WHEN v_fee > 0 THEN v_from_acc.currency ELSE NULL END,
    v_out_tx_id, v_in_tx_id,
    v_occurred, NULLIF(trim(COALESCE(p_notes, '')), ''), 'posted',
    NULLIF(trim(COALESCE(p_idempotency_key, '')), '')
  )
  RETURNING id INTO v_transfer_id;

  UPDATE public.transactions
  SET transfer_id = v_transfer_id
  WHERE id IN (v_out_tx_id, v_in_tx_id);

  -- Append immutable debit ledger entry for source principal
  INSERT INTO public.ledger_entries (
    workspace_id, transaction_id, account_id, entry_group_id,
    direction, amount, signed_amount, currency, balance_after,
    is_reversal, occurred_at, created_by
  )
  VALUES (
    p_workspace_id, v_out_tx_id, v_from_acc.id, v_group_id,
    'debit', p_from_amount, -p_from_amount, v_from_acc.currency, v_after_principal,
    false, v_occurred, p_created_by
  );

  -- Append immutable debit ledger entry for optional transfer fee
  IF v_fee > 0 THEN
    INSERT INTO public.ledger_entries (
      workspace_id, transaction_id, account_id, entry_group_id,
      direction, amount, signed_amount, currency, balance_after,
      is_reversal, occurred_at, created_by
    )
    VALUES (
      p_workspace_id, v_out_tx_id, v_from_acc.id, v_group_id,
      'debit', v_fee, -v_fee, v_from_acc.currency, v_from_new_bal,
      false, v_occurred, p_created_by
    );
  END IF;

  -- Append immutable credit ledger entry for destination account
  INSERT INTO public.ledger_entries (
    workspace_id, transaction_id, account_id, entry_group_id,
    direction, amount, signed_amount, currency, balance_after,
    is_reversal, occurred_at, created_by
  )
  VALUES (
    p_workspace_id, v_in_tx_id, v_to_acc.id, v_group_id,
    'credit', p_to_amount, p_to_amount, v_to_acc.currency, v_to_new_bal,
    false, v_occurred, p_created_by
  );

  UPDATE public.accounts SET current_balance = v_from_new_bal WHERE id = v_from_acc.id;
  UPDATE public.accounts SET current_balance = v_to_new_bal WHERE id = v_to_acc.id;

  RETURN QUERY SELECT v_transfer_id, v_out_tx_id, v_in_tx_id, v_from_new_bal, v_to_new_bal, false;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Atomic Transfer Void / Reversal (Reverses All Legs + Fee Atomically)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_transfer_atomic(
  p_workspace_id UUID,
  p_transfer_id UUID,
  p_actor_user_id UUID
)
RETURNS TABLE (
  transfer_id UUID,
  from_new_balance NUMERIC(20, 4),
  to_new_balance NUMERIC(20, 4)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_tr RECORD;
  v_from_acc RECORD;
  v_to_acc RECORD;
  v_entry RECORD;
  v_from_bal NUMERIC(20, 4);
  v_to_bal NUMERIC(20, 4);
  v_rev_group_id UUID := gen_random_uuid();
BEGIN
  SELECT * INTO v_tr
  FROM public.transfers
  WHERE id = p_transfer_id
    AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF v_tr.id IS NULL THEN
    RAISE EXCEPTION 'Transfer not found in workspace' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_tr.status = 'voided' THEN
    RAISE EXCEPTION 'Transfer is already voided' USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_tr.from_account_id < v_tr.to_account_id THEN
    SELECT * INTO v_from_acc FROM public.accounts WHERE id = v_tr.from_account_id FOR UPDATE;
    SELECT * INTO v_to_acc FROM public.accounts WHERE id = v_tr.to_account_id FOR UPDATE;
  ELSE
    SELECT * INTO v_to_acc FROM public.accounts WHERE id = v_tr.to_account_id FOR UPDATE;
    SELECT * INTO v_from_acc FROM public.accounts WHERE id = v_tr.from_account_id FOR UPDATE;
  END IF;

  v_from_bal := v_from_acc.current_balance;
  v_to_bal := v_to_acc.current_balance;

  -- Reverse all original ledger entries belonging to both legs
  FOR v_entry IN
    SELECT *
    FROM public.ledger_entries
    WHERE transaction_id IN (v_tr.outgoing_transaction_id, v_tr.incoming_transaction_id)
      AND is_reversal = false
    ORDER BY created_at ASC
  LOOP
    IF v_entry.account_id = v_from_acc.id THEN
      v_from_bal := v_from_bal - v_entry.signed_amount;
      INSERT INTO public.ledger_entries (
        workspace_id, transaction_id, account_id, entry_group_id,
        direction, amount, signed_amount, currency, balance_after,
        is_reversal, reversed_entry_id, occurred_at, created_by
      )
      VALUES (
        p_workspace_id, v_entry.transaction_id, v_entry.account_id, v_rev_group_id,
        CASE WHEN v_entry.direction = 'credit' THEN 'debit'::public.ledger_direction ELSE 'credit'::public.ledger_direction END,
        v_entry.amount, -v_entry.signed_amount, v_entry.currency, v_from_bal,
        true, v_entry.id, now(), p_actor_user_id
      );
    ELSE
      v_to_bal := v_to_bal - v_entry.signed_amount;
      INSERT INTO public.ledger_entries (
        workspace_id, transaction_id, account_id, entry_group_id,
        direction, amount, signed_amount, currency, balance_after,
        is_reversal, reversed_entry_id, occurred_at, created_by
      )
      VALUES (
        p_workspace_id, v_entry.transaction_id, v_entry.account_id, v_rev_group_id,
        CASE WHEN v_entry.direction = 'credit' THEN 'debit'::public.ledger_direction ELSE 'credit'::public.ledger_direction END,
        v_entry.amount, -v_entry.signed_amount, v_entry.currency, v_to_bal,
        true, v_entry.id, now(), p_actor_user_id
      );
    END IF;
  END LOOP;

  UPDATE public.accounts SET current_balance = v_from_bal WHERE id = v_from_acc.id;
  UPDATE public.accounts SET current_balance = v_to_bal WHERE id = v_to_acc.id;
  UPDATE public.transactions SET status = 'voided' WHERE id IN (v_tr.outgoing_transaction_id, v_tr.incoming_transaction_id);
  UPDATE public.transfers SET status = 'voided' WHERE id = v_tr.id;

  RETURN QUERY SELECT v_tr.id, v_from_bal, v_to_bal;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. Deterministic Workspace Ledger Reconciliation Check
-- Verifies: accounts.opening_balance + SUM(ledger_entries.signed_amount) = current_balance
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_workspace_accounts(p_workspace_id UUID)
RETURNS TABLE (
  account_id UUID,
  account_name TEXT,
  currency CHAR(3),
  opening_balance NUMERIC(20, 4),
  ledger_net_sum NUMERIC(20, 4),
  expected_balance NUMERIC(20, 4),
  recorded_balance NUMERIC(20, 4),
  discrepancy NUMERIC(20, 4),
  is_balanced BOOLEAN,
  entry_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id AS account_id,
    a.name AS account_name,
    a.currency,
    a.opening_balance,
    COALESCE(SUM(le.signed_amount), 0)::NUMERIC(20, 4) AS ledger_net_sum,
    (a.opening_balance + COALESCE(SUM(le.signed_amount), 0))::NUMERIC(20, 4) AS expected_balance,
    a.current_balance AS recorded_balance,
    (a.current_balance - (a.opening_balance + COALESCE(SUM(le.signed_amount), 0)))::NUMERIC(20, 4) AS discrepancy,
    (a.current_balance = (a.opening_balance + COALESCE(SUM(le.signed_amount), 0))) AS is_balanced,
    COUNT(le.id) AS entry_count
  FROM public.accounts a
  LEFT JOIN public.ledger_entries le ON le.account_id = a.id
  WHERE a.workspace_id = p_workspace_id
  GROUP BY a.id, a.name, a.currency, a.opening_balance, a.current_balance
  ORDER BY a.created_at ASC;
$$;
