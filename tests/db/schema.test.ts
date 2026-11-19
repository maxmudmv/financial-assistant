import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations');

function readAllMigrationsSql(): string {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((file) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')).join('\n');
}

const REQUIRED_TABLES = [
  'users',
  'sessions',
  'workspaces',
  'workspace_members',
  'workspace_invitations',
  'accounts',
  'categories',
  'transactions',
  'ledger_entries',
  'transfers',
  'budgets',
  'savings_goals',
  'savings_contributions',
  'debts',
  'debt_payments',
  'recurring_rules',
  'recurring_executions',
  'notifications',
  'notification_preferences',
  'exchange_rates',
  'attachments',
  'audit_logs',
  'user_settings',
  'idempotency_keys',
  'rate_limit_buckets',
];

describe('PostgreSQL database migrations & RLS security contract', () => {
  const fullSql = readAllMigrationsSql();

  it('creates all 23 required domain tables plus security infrastructure tables', () => {
    for (const table of REQUIRED_TABLES) {
      const pattern = new RegExp(`CREATE TABLE public\\.${table}\\b`, 'i');
      expect(fullSql, `Missing CREATE TABLE for public.${table}`).toMatch(pattern);
    }
  });

  it('enables Row Level Security (RLS) on every single table', () => {
    for (const table of REQUIRED_TABLES) {
      const pattern = new RegExp(
        `ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`,
        'i',
      );
      expect(fullSql, `Missing ENABLE ROW LEVEL SECURITY on public.${table}`).toMatch(pattern);
    }
  });

  it('never uses floating-point SQL types for money (enforces NUMERIC)', () => {
    expect(fullSql).not.toMatch(/\b(DOUBLE PRECISION|REAL|FLOAT4|FLOAT8)\b/i);
    expect(fullSql).toMatch(/NUMERIC\(20,\s*4\)/i);
    expect(fullSql).toMatch(/NUMERIC\(20,\s*8\)/i);
  });

  it('enforces database-level immutability triggers on ledger_entries and audit_logs', () => {
    expect(fullSql).toMatch(/CREATE TRIGGER trg_ledger_entries_immutable/i);
    expect(fullSql).toMatch(/CREATE TRIGGER trg_audit_logs_immutable/i);
    expect(fullSql).toMatch(/BEFORE UPDATE OR DELETE ON public\.ledger_entries/i);
    expect(fullSql).toMatch(/BEFORE UPDATE OR DELETE ON public\.audit_logs/i);
  });

  it('enforces idempotency unique constraints on recurring executions and notifications', () => {
    expect(fullSql).toMatch(/UNIQUE \(rule_id, scheduled_for\)/i);
    expect(fullSql).toMatch(/idx_notifications_dedupe/i);
  });

  it('provides atomic row-locked PostgreSQL financial engine and reconciliation RPCs', () => {
    const requiredRpcs = [
      'post_transaction_atomic',
      'edit_transaction_atomic',
      'void_transaction_atomic',
      'post_transfer_atomic',
      'void_transfer_atomic',
      'reconcile_workspace_accounts',
    ];
    for (const rpc of requiredRpcs) {
      expect(fullSql, `Missing RPC public.${rpc}`).toMatch(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}\\b`, 'i'),
      );
    }
    expect(fullSql).toMatch(/FOR UPDATE;/i);
  });
});
