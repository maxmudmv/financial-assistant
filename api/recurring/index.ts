import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { parseJsonBody, sendJson, withApiHandler } from '../../server/http/response';
import {
  BadRequestError,
  NotFoundError,
  ValidationError,
} from '../../server/security/errors';
import { getSupabaseAdmin } from '../../server/db/supabase';
import {
  ALL_ROLES,
  assertAccountAccessible,
  authenticateFinanceRequest,
  verifyCronAuthorization,
  WRITE_ROLES,
  type AccountAccessRecord,
} from '../../server/finance/access';
import { formatMoneyFixed4, parsePositiveMoney } from '../../server/finance/money';
import { processDueRecurringRules } from '../../server/finance/recurring';

const CreateRecurringSchema = z.object({
  name: z.string().trim().min(1).max(80),
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().optional().nullable(),
  type: z.enum(['income', 'expense', 'transfer']),
  targetAccountId: z.string().uuid().optional().nullable(),
  amount: z.union([z.string(), z.number()]),
  frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']),
  intervalCount: z.number().int().min(1).max(365).default(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  requiresConfirmation: z.boolean().default(false),
  notes: z.string().trim().max(300).optional().nullable(),
});

function resolveSub(req: VercelRequest): {
  mode: 'root' | 'cron' | 'confirm' | 'skip' | 'toggle';
  id: string | null;
} {
  const qAction = typeof req.query.action === 'string' ? req.query.action.trim() : '';
  const qSub = typeof req.query.sub === 'string' ? req.query.sub.trim() : '';

  if (qAction === 'cron' || qSub === 'cron') return { mode: 'cron', id: null };
  if (qSub && qAction === 'confirm') return { mode: 'confirm', id: qSub };
  if (qSub && qAction === 'skip') return { mode: 'skip', id: qSub };
  if (qSub && qAction === 'toggle') return { mode: 'toggle', id: qSub };

  const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
  if (parts[2] === 'cron') return { mode: 'cron', id: null };
  if (parts[2] && parts[3] === 'confirm') return { mode: 'confirm', id: parts[2] };
  if (parts[2] && parts[3] === 'skip') return { mode: 'skip', id: parts[2] };
  if (parts[2] && parts[3] === 'toggle') return { mode: 'toggle', id: parts[2] };
  return { mode: 'root', id: parts[2] ?? null };
}

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  const route = resolveSub(req);

  // --------------------------------------------------------------------------
  // GET /api/recurring/cron — Daily Vercel Hobby Cron (Fail-Closed CRON_SECRET)
  // --------------------------------------------------------------------------
  if (route.mode === 'cron') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      throw new BadRequestError('Method not allowed for cron');
    }
    verifyCronAuthorization(
      typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      process.env.CRON_SECRET,
    );

    const supabase = getSupabaseAdmin();
    const result = await processDueRecurringRules({
      supabase,
      maxRules: 50,
    });

    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  // --------------------------------------------------------------------------
  // GET /api/recurring — Lazy process due rules + list rules & pending executions
  // --------------------------------------------------------------------------
  if (route.mode === 'root' && !route.id && req.method === 'GET') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'recurring:list',
    });

    await processDueRecurringRules({
      supabase: ctx.supabase,
      workspaceId: ctx.workspace.id,
      maxRules: 15,
    });

    const [rulesRes, pendingRes] = await Promise.all([
      ctx.supabase
        .from('recurring_rules')
        .select(
          'id, name, type, account_id, target_account_id, category_id, amount, currency, frequency, interval_count, start_date, end_date, next_run_date, requires_confirmation, is_active, last_run_at, notes',
        )
        .eq('workspace_id', ctx.workspace.id)
        .order('next_run_date', { ascending: true }),
      ctx.supabase
        .from('recurring_executions')
        .select(
          'id, rule_id, scheduled_for, status, rule:recurring_rules(id, name, type, amount, currency)',
        )
        .eq('workspace_id', ctx.workspace.id)
        .eq('status', 'pending_confirmation')
        .order('scheduled_for', { ascending: true }),
    ]);

    sendJson(res, 200, {
      rules: rulesRes.data ?? [],
      pendingConfirmations: pendingRes.data ?? [],
    });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/recurring — Create recurring rule
  // --------------------------------------------------------------------------
  if (route.mode === 'root' && !route.id && req.method === 'POST') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'recurring:create',
    });

    const parsed = CreateRecurringSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid recurring rule payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const amount = formatMoneyFixed4(parsePositiveMoney(parsed.data.amount, 'amount'));

    const { data: account } = await ctx.supabase
      .from('accounts')
      .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, currency')
      .eq('id', parsed.data.accountId)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!account) throw new NotFoundError('Account not found');
    assertAccountAccessible(
      account as AccountAccessRecord,
      ctx.session.user.id,
      ctx.workspace.id,
    );

    const { data, error } = await ctx.supabase
      .from('recurring_rules')
      .insert({
        workspace_id: ctx.workspace.id,
        account_id: parsed.data.accountId,
        target_account_id:
          parsed.data.type === 'transfer' ? (parsed.data.targetAccountId ?? null) : null,
        category_id: parsed.data.categoryId ?? null,
        created_by: ctx.session.user.id,
        name: parsed.data.name,
        type: parsed.data.type,
        amount,
        currency: account.currency,
        frequency: parsed.data.frequency,
        interval_count: parsed.data.intervalCount,
        start_date: parsed.data.startDate,
        end_date: parsed.data.endDate ?? null,
        next_run_date: parsed.data.startDate,
        requires_confirmation: parsed.data.requiresConfirmation,
        notes: parsed.data.notes ?? null,
      })
      .select('id, name, type, amount, currency, frequency, next_run_date, requires_confirmation')
      .single();

    if (error || !data) throw new Error(`Failed to create recurring rule: ${error?.message ?? 'unknown'}`);
    sendJson(res, 201, { rule: data });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/recurring/:executionId/confirm — Execute pending confirmation
  // --------------------------------------------------------------------------
  if (route.mode === 'confirm' && route.id && req.method === 'POST') {
    if (!z.string().uuid().safeParse(route.id).success) {
      throw new BadRequestError('Invalid execution ID');
    }

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'recurring:confirm',
    });

    const { data: exec } = await ctx.supabase
      .from('recurring_executions')
      .select(
        'id, rule_id, scheduled_for, status, rule:recurring_rules(id, account_id, target_account_id, category_id, name, type, amount, currency)',
      )
      .eq('id', route.id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!exec || exec.status !== 'pending_confirmation') {
      throw new NotFoundError('Pending recurring execution not found');
    }

    const rule = (Array.isArray(exec.rule) ? exec.rule[0] : exec.rule) as {
      id: string;
      account_id: string;
      target_account_id: string | null;
      category_id: string | null;
      name: string;
      type: string;
      amount: string | number;
      currency: string;
    };

    const { data: sourceAccount } = await ctx.supabase
      .from('accounts')
      .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, is_archived')
      .eq('id', rule.account_id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!sourceAccount || sourceAccount.is_archived) {
      throw new NotFoundError('Rule account is missing or archived');
    }
    assertAccountAccessible(
      sourceAccount as AccountAccessRecord,
      ctx.session.user.id,
      ctx.workspace.id,
    );

    const confirmIdemKey = `rec-confirm:${exec.id}:${crypto
      .createHash('sha1')
      .update(String(exec.scheduled_for))
      .digest('hex')}`;

    let txId: string;
    if (rule.type === 'transfer' && rule.target_account_id) {
      const { data: targetAccount } = await ctx.supabase
        .from('accounts')
        .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, is_archived')
        .eq('id', rule.target_account_id)
        .eq('workspace_id', ctx.workspace.id)
        .maybeSingle();

      if (!targetAccount || targetAccount.is_archived) {
        throw new NotFoundError('Transfer destination account is missing or archived');
      }
      assertAccountAccessible(
        targetAccount as AccountAccessRecord,
        ctx.session.user.id,
        ctx.workspace.id,
      );

      const { data: trRows, error: trErr } = await ctx.supabase.rpc('post_transfer_atomic', {
        p_workspace_id: ctx.workspace.id,
        p_created_by: ctx.session.user.id,
        p_from_account_id: rule.account_id,
        p_to_account_id: rule.target_account_id,
        p_from_amount: formatMoneyFixed4(rule.amount),
        p_to_amount: formatMoneyFixed4(rule.amount),
        p_exchange_rate: 1,
        p_fee_amount: 0,
        p_occurred_at: new Date().toISOString(),
        p_notes: `Confirmed recurring transfer: ${rule.name}`,
        p_idempotency_key: confirmIdemKey,
      });

      if (trErr || !Array.isArray(trRows) || trRows.length === 0) {
        throw new BadRequestError(trErr?.message ?? 'Failed to confirm recurring transfer');
      }
      txId = (trRows[0] as { outgoing_transaction_id: string }).outgoing_transaction_id;
    } else {
      const { data: txRows, error: txErr } = await ctx.supabase.rpc('post_transaction_atomic', {
        p_workspace_id: ctx.workspace.id,
        p_account_id: rule.account_id,
        p_category_id: rule.category_id,
        p_created_by: ctx.session.user.id,
        p_type: rule.type,
        p_amount: formatMoneyFixed4(rule.amount),
        p_reporting_currency: rule.currency,
        p_exchange_rate_used: 1,
        p_reporting_amount: formatMoneyFixed4(rule.amount),
        p_exchange_rate_id: null,
        p_occurred_at: new Date().toISOString(),
        p_description: rule.name,
        p_notes: 'Confirmed recurring payment',
        p_tags: ['recurring'],
        p_is_private: false,
        p_idempotency_key: confirmIdemKey,
        p_adjustment_direction: 'credit',
      });

      if (txErr || !Array.isArray(txRows) || txRows.length === 0) {
        throw new BadRequestError(txErr?.message ?? 'Failed to confirm recurring execution');
      }
      txId = (txRows[0] as { transaction_id: string }).transaction_id;
    }

    await ctx.supabase
      .from('recurring_executions')
      .update({
        status: 'executed',
        transaction_id: txId,
        executed_by: ctx.session.user.id,
        executed_at: new Date().toISOString(),
      })
      .eq('id', exec.id);

    sendJson(res, 200, { executionId: exec.id, transactionId: txId, status: 'executed' });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/recurring/:executionId/skip
  // --------------------------------------------------------------------------
  if (route.mode === 'skip' && route.id && req.method === 'POST') {
    if (!z.string().uuid().safeParse(route.id).success) {
      throw new BadRequestError('Invalid execution ID');
    }

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'recurring:skip',
    });

    await ctx.supabase
      .from('recurring_executions')
      .update({
        status: 'skipped',
        executed_by: ctx.session.user.id,
        executed_at: new Date().toISOString(),
      })
      .eq('id', route.id)
      .eq('workspace_id', ctx.workspace.id)
      .eq('status', 'pending_confirmation');

    sendJson(res, 200, { executionId: route.id, status: 'skipped' });
    return;
  }

  // --------------------------------------------------------------------------
  // POST /api/recurring/:ruleId/toggle — Pause/Resume rule
  // --------------------------------------------------------------------------
  if (route.mode === 'toggle' && route.id && req.method === 'POST') {
    if (!z.string().uuid().safeParse(route.id).success) {
      throw new BadRequestError('Invalid recurring rule ID');
    }
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'recurring:toggle',
    });

    const { data: rule } = await ctx.supabase
      .from('recurring_rules')
      .select('id, is_active')
      .eq('id', route.id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!rule) throw new NotFoundError('Recurring rule not found');

    const nextActive = !rule.is_active;
    await ctx.supabase
      .from('recurring_rules')
      .update({ is_active: nextActive })
      .eq('id', route.id);

    sendJson(res, 200, { id: route.id, isActive: nextActive });
    return;
  }

  throw new NotFoundError('Recurring endpoint not found');
});
