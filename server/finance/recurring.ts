import type { SupabaseClient } from '@supabase/supabase-js';

export type RecurrenceFrequency =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly';

export function computeNextRunDate(
  currentDateIso: string,
  frequency: RecurrenceFrequency,
  intervalCount = 1,
): string {
  const [y, m, d] = currentDateIso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const step = Math.max(1, intervalCount);

  switch (frequency) {
    case 'daily':
      dt.setUTCDate(dt.getUTCDate() + step);
      break;
    case 'weekly':
      dt.setUTCDate(dt.getUTCDate() + 7 * step);
      break;
    case 'biweekly':
      dt.setUTCDate(dt.getUTCDate() + 14 * step);
      break;
    case 'monthly':
      dt.setUTCMonth(dt.getUTCMonth() + step);
      break;
    case 'quarterly':
      dt.setUTCMonth(dt.getUTCMonth() + 3 * step);
      break;
    case 'yearly':
      dt.setUTCFullYear(dt.getUTCFullYear() + step);
      break;
  }

  return dt.toISOString().slice(0, 10);
}

/**
 * Serverless-safe idempotent recurring execution processor.
 * Runs lazily when users open the app or via daily Vercel Cron.
 * Uses `UNIQUE (rule_id, scheduled_for)` in `recurring_executions` + atomic RPCs
 * to guarantee zero duplicate transactions even under concurrent invocations.
 */
export async function processDueRecurringRules(options: {
  supabase: SupabaseClient;
  workspaceId?: string;
  todayIso?: string;
  maxRules?: number;
}): Promise<{
  processedCount: number;
  executedCount: number;
  pendingConfirmationCount: number;
}> {
  const todayIso = options.todayIso ?? new Date().toISOString().slice(0, 10);

  let query = options.supabase
    .from('recurring_rules')
    .select(
      'id, workspace_id, account_id, category_id, created_by, name, type, target_account_id, amount, currency, frequency, interval_count, end_date, next_run_date, requires_confirmation',
    )
    .eq('is_active', true)
    .lte('next_run_date', todayIso)
    .order('next_run_date', { ascending: true })
    .limit(options.maxRules ?? 25);

  if (options.workspaceId) {
    query = query.eq('workspace_id', options.workspaceId);
  }

  const { data: dueRules, error } = await query;
  if (error || !dueRules || dueRules.length === 0) {
    return { processedCount: 0, executedCount: 0, pendingConfirmationCount: 0 };
  }

  let processedCount = 0;
  let executedCount = 0;
  let pendingConfirmationCount = 0;

  for (const rule of dueRules) {
    const scheduledFor = String(rule.next_run_date).slice(0, 10);

    // Attempt to claim execution slot idempotently
    const { data: execRow, error: insertErr } = await options.supabase
      .from('recurring_executions')
      .insert({
        workspace_id: rule.workspace_id,
        rule_id: rule.id,
        scheduled_for: scheduledFor,
        status: rule.requires_confirmation ? 'pending_confirmation' : 'executed',
      })
      .select('id, status')
      .maybeSingle();

    // Unique violation (23505) means another concurrent serverless call already claimed this slot
    if (insertErr || !execRow) {
      continue;
    }

    processedCount += 1;
    let txId: string | null = null;

    if (rule.requires_confirmation) {
      pendingConfirmationCount += 1;
    } else {
      try {
        if (rule.type === 'transfer' && rule.target_account_id) {
          const { data: trRows } = await options.supabase.rpc('post_transfer_atomic', {
            p_workspace_id: rule.workspace_id,
            p_created_by: rule.created_by,
            p_from_account_id: rule.account_id,
            p_to_account_id: rule.target_account_id,
            p_from_amount: rule.amount,
            p_to_amount: rule.amount,
            p_exchange_rate: 1,
            p_fee_amount: 0,
            p_occurred_at: `${scheduledFor}T09:00:00.000Z`,
            p_notes: `Recurring: ${rule.name}`,
            p_idempotency_key: `rec:${rule.id}:${scheduledFor}`,
          });
          if (Array.isArray(trRows) && trRows[0]) {
            txId = (trRows[0] as { outgoing_transaction_id: string }).outgoing_transaction_id;
          }
        } else {
          const { data: txRows } = await options.supabase.rpc('post_transaction_atomic', {
            p_workspace_id: rule.workspace_id,
            p_account_id: rule.account_id,
            p_category_id: rule.category_id,
            p_created_by: rule.created_by,
            p_type: rule.type,
            p_amount: rule.amount,
            p_reporting_currency: rule.currency,
            p_exchange_rate_used: 1,
            p_reporting_amount: rule.amount,
            p_exchange_rate_id: null,
            p_occurred_at: `${scheduledFor}T09:00:00.000Z`,
            p_description: rule.name,
            p_notes: 'Recurring schedule',
            p_tags: ['recurring'],
            p_is_private: false,
            p_idempotency_key: `rec:${rule.id}:${scheduledFor}`,
            p_adjustment_direction: 'credit',
          });
          if (Array.isArray(txRows) && txRows[0]) {
            txId = (txRows[0] as { transaction_id: string }).transaction_id;
          }
        }

        await options.supabase
          .from('recurring_executions')
          .update({
            transaction_id: txId,
            executed_by: rule.created_by,
            executed_at: new Date().toISOString(),
          })
          .eq('id', execRow.id);

        executedCount += 1;
      } catch (err) {
        await options.supabase
          .from('recurring_executions')
          .update({
            status: 'failed',
            error_message: err instanceof Error ? err.message : 'Execution failed',
          })
          .eq('id', execRow.id);
      }
    }

    const nextDate = computeNextRunDate(
      scheduledFor,
      rule.frequency as RecurrenceFrequency,
      Number(rule.interval_count) || 1,
    );
    const shouldDeactivate = Boolean(rule.end_date && nextDate > String(rule.end_date).slice(0, 10));

    await options.supabase
      .from('recurring_rules')
      .update({
        next_run_date: nextDate,
        last_run_at: new Date().toISOString(),
        is_active: !shouldDeactivate,
      })
      .eq('id', rule.id);
  }

  return { processedCount, executedCount, pendingConfirmationCount };
}
