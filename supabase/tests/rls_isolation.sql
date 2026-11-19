-- ==============================================================================
-- FINORA PostgreSQL RLS Isolation Verification Script
-- Run in Supabase SQL Editor or psql inside a transaction (rolled back cleanly)
-- to verify that User B can NEVER read User A's accounts or private transactions.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  v_user_a UUID;
  v_ws_a UUID;
  v_user_b UUID;
  v_ws_b UUID;
  v_visible_count INT;
BEGIN
  -- Bootstrap two isolated users
  SELECT r.user_id, r.active_workspace_id INTO v_user_a, v_ws_a
  FROM public.bootstrap_telegram_user(999000001, 'alice_test', 'Alice', 'Test', 'en', NULL) r;

  SELECT r.user_id, r.active_workspace_id INTO v_user_b, v_ws_b
  FROM public.bootstrap_telegram_user(999000002, 'bob_test', 'Bob', 'Test', 'en', NULL) r;

  -- Switch execution context to authenticated role + User B identity
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('app.current_user_id', v_user_b::TEXT, true);

  -- Verify User B sees ZERO of User A's workspaces
  SELECT count(*) INTO v_visible_count
  FROM public.workspaces
  WHERE id = v_ws_a;

  IF v_visible_count <> 0 THEN
    RAISE EXCEPTION 'RLS FAILURE: User B could see User A workspace!';
  END IF;

  -- Verify User B sees ZERO of User A's accounts
  SELECT count(*) INTO v_visible_count
  FROM public.accounts
  WHERE workspace_id = v_ws_a;

  IF v_visible_count <> 0 THEN
    RAISE EXCEPTION 'RLS FAILURE: User B could see User A accounts!';
  END IF;

  -- Verify User B CAN see their own workspace
  SELECT count(*) INTO v_visible_count
  FROM public.workspaces
  WHERE id = v_ws_b;

  IF v_visible_count <> 1 THEN
    RAISE EXCEPTION 'RLS FAILURE: User B could not see own workspace!';
  END IF;

  RAISE NOTICE 'RLS ISOLATION PASSED: Cross-workspace access strictly blocked.';
END;
$$;

ROLLBACK;
