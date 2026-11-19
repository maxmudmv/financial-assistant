-- ==============================================================================
-- FINORA Migration 0001: Extensions, Custom Enums, and Shared Trigger Utilities
-- Target: Supabase PostgreSQL (Free Tier Compatible)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Workspace classification
CREATE TYPE public.workspace_type AS ENUM ('personal', 'family');

-- Role-based access control for workspaces
CREATE TYPE public.workspace_role AS ENUM ('owner', 'admin', 'member', 'read_only');

-- Invitation lifecycle
CREATE TYPE public.invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- Account categories & visibility
CREATE TYPE public.account_type AS ENUM (
  'cash',
  'bank_card',
  'bank_account',
  'savings',
  'investment',
  'e_wallet',
  'credit',
  'other'
);

CREATE TYPE public.account_visibility AS ENUM ('workspace', 'private', 'selected_members');

-- Transaction & category enums
CREATE TYPE public.category_type AS ENUM ('income', 'expense', 'both');

CREATE TYPE public.transaction_type AS ENUM (
  'income',
  'expense',
  'transfer',
  'refund',
  'adjustment',
  'savings_contribution',
  'savings_withdrawal',
  'debt_repayment'
);

CREATE TYPE public.transaction_status AS ENUM ('posted', 'voided', 'pending');

CREATE TYPE public.ledger_direction AS ENUM ('debit', 'credit');

-- Planning, savings, debts, recurring
CREATE TYPE public.budget_period AS ENUM ('weekly', 'monthly', 'custom');

CREATE TYPE public.goal_status AS ENUM ('active', 'completed', 'paused', 'cancelled');

CREATE TYPE public.debt_direction AS ENUM ('borrowed', 'lent');

CREATE TYPE public.debt_status AS ENUM ('open', 'partially_paid', 'paid', 'overdue', 'cancelled');

CREATE TYPE public.recurrence_frequency AS ENUM (
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly'
);

CREATE TYPE public.recurring_execution_status AS ENUM (
  'pending_confirmation',
  'executed',
  'skipped',
  'failed'
);

-- Notifications & user preferences
CREATE TYPE public.notification_channel AS ENUM ('in_app', 'telegram', 'both');

CREATE TYPE public.notification_delivery_status AS ENUM (
  'pending',
  'sent',
  'failed',
  'read',
  'suppressed'
);

CREATE TYPE public.theme_preference AS ENUM ('system', 'dark', 'light');

CREATE TYPE public.language_code AS ENUM ('uz', 'ru', 'en');

-- Shared updated_at trigger helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Shared immutability enforcement trigger (for ledger_entries and audit_logs)
CREATE OR REPLACE FUNCTION public.prevent_record_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Records in % are immutable and cannot be %d', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'restrict_violation';
END;
$$;
