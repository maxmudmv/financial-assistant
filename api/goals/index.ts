import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { parseJsonBody, sendJson, withApiHandler } from '../../server/http/response';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../server/security/errors';
import { recordAuditLog } from '../../server/security/audit';
import {
  ALL_ROLES,
  assertAccountAccessible,
  authenticateFinanceRequest,
  canUserAccessScopedRecord,
  WRITE_ROLES,
  type AccountAccessRecord,
} from '../../server/finance/access';
import {
  formatMoneyFixed4,
  normalizeCurrencyCode,
  parsePositiveMoney,
} from '../../server/finance/money';
import { dispatchWorkspaceNotification } from '../../server/notifications/telegramBot';

const CreateGoalSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional().nullable(),
  targetAmount: z.union([z.string(), z.number()]),
  currency: z.string().trim().length(3),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  linkedAccountId: z.string().uuid().optional().nullable(),
  color: z.string().max(32).default('#10B981'),
  isShared: z.boolean().default(true),
});

const UpdateGoalSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional().nullable(),
  targetAmount: z.union([z.string(), z.number()]).optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['active', 'completed', 'paused', 'cancelled']).optional(),
  isShared: z.boolean().optional(),
});

const ContributeGoalSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.union([z.string(), z.number()]),
  direction: z.enum(['deposit', 'withdrawal']).default('deposit'),
  notes: z.string().trim().max(300).optional().nullable(),
});

function resolveSub(req: VercelRequest): { id: string | null; action: string | null } {
  const qSub = typeof req.query.sub === 'string' ? req.query.sub.trim() : null;
  const qAction = typeof req.query.action === 'string' ? req.query.action.trim() : null;
  if (qSub) return { id: qSub, action: qAction };
  const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
  return { id: parts[2] ?? null, action: parts[3] ?? null };
}

export default withApiHandler(async (req: VercelRequest, res: VercelResponse) => {
  const { id, action } = resolveSub(req);

  // GET /api/goals
  if (!id && req.method === 'GET') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'goals:list',
    });

    const { data, error } = await ctx.supabase
      .from('savings_goals')
      .select(
        'id, name, description, target_amount, current_amount, currency, deadline, color, status, is_shared, created_by, linked_account_id, created_at',
      )
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch savings goals: ${error.message}`);

    const visible = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((g) => Boolean(g.is_shared) || g.created_by === ctx.session.user.id)
      .map((g) => {
        const target = new Decimal(g.target_amount as string | number);
        const current = new Decimal(g.current_amount as string | number);
        const remaining = Decimal.max(0, target.minus(current));
        return {
          id: g.id,
          name: g.name,
          description: g.description,
          targetAmount: formatMoneyFixed4(target),
          currentAmount: formatMoneyFixed4(current),
          remainingAmount: formatMoneyFixed4(remaining),
          currency: g.currency,
          deadline: g.deadline,
          color: g.color || '#10B981',
          status: g.status,
          isShared: Boolean(g.is_shared),
          linkedAccountId: g.linked_account_id,
          progressPct: target.gt(0)
            ? Math.min(100, current.div(target).times(100).toDecimalPlaces(1).toNumber())
            : 0,
        };
      });

    sendJson(res, 200, { goals: visible });
    return;
  }

  // POST /api/goals
  if (!id && req.method === 'POST') {
    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'goals:create',
    });

    const parsed = CreateGoalSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid savings goal payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const targetAmount = formatMoneyFixed4(parsePositiveMoney(parsed.data.targetAmount, 'targetAmount'));
    const currency = normalizeCurrencyCode(parsed.data.currency);

    const { data, error } = await ctx.supabase
      .from('savings_goals')
      .insert({
        workspace_id: ctx.workspace.id,
        created_by: ctx.session.user.id,
        linked_account_id: parsed.data.linkedAccountId ?? null,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        target_amount: targetAmount,
        current_amount: '0.0000',
        currency,
        deadline: parsed.data.deadline ?? null,
        color: parsed.data.color,
        is_shared: parsed.data.isShared,
      })
      .select('id, name, target_amount, current_amount, currency, deadline, status')
      .single();

    if (error || !data) throw new Error(`Failed to create goal: ${error?.message ?? 'unknown'}`);

    await recordAuditLog(ctx.supabase, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.session.user.id,
      action: 'goal.created',
      entityType: 'savings_goal',
      entityId: data.id as string,
      ipAddress: ctx.clientIp,
      userAgent: ctx.userAgent,
    });

    sendJson(res, 201, { goal: data });
    return;
  }

  // PATCH /api/goals/:id — Edit goal
  if (id && !action && req.method === 'PATCH') {
    if (!z.string().uuid().safeParse(id).success) throw new BadRequestError('Invalid goal ID');

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'goals:update',
    });

    const parsed = UpdateGoalSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid goal update payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const { data: existingGoal } = await ctx.supabase
      .from('savings_goals')
      .select('id, is_shared, created_by')
      .eq('id', id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!existingGoal) throw new NotFoundError('Savings goal not found');
    if (
      !canUserAccessScopedRecord({
        isPrivate: !existingGoal.is_shared,
        createdBy: String(existingGoal.created_by),
        userId: ctx.session.user.id,
      })
    ) {
      throw new ForbiddenError('Cannot modify another member private savings goal');
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.targetAmount !== undefined) {
      updates.target_amount = formatMoneyFixed4(
        parsePositiveMoney(parsed.data.targetAmount, 'targetAmount'),
      );
    }
    if (parsed.data.deadline !== undefined) updates.deadline = parsed.data.deadline;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.isShared !== undefined) updates.is_shared = parsed.data.isShared;

    if (Object.keys(updates).length === 0) {
      throw new BadRequestError('No fields provided to update');
    }

    const { data, error } = await ctx.supabase
      .from('savings_goals')
      .update(updates)
      .eq('id', id)
      .eq('workspace_id', ctx.workspace.id)
      .select('id, name, target_amount, current_amount, currency, deadline, status, is_shared')
      .single();

    if (error || !data) throw new NotFoundError('Savings goal not found');
    sendJson(res, 200, { goal: data });
    return;
  }

  // GET /api/goals/:id/history — Contribution & withdrawal history
  if (id && action === 'history' && req.method === 'GET') {
    if (!z.string().uuid().safeParse(id).success) throw new BadRequestError('Invalid goal ID');

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: ALL_ROLES,
      rateLimitKey: 'goals:history',
    });

    const { data: goal } = await ctx.supabase
      .from('savings_goals')
      .select('id, is_shared, created_by')
      .eq('id', id)
      .eq('workspace_id', ctx.workspace.id)
      .maybeSingle();

    if (!goal) throw new NotFoundError('Savings goal not found');
    if (
      !canUserAccessScopedRecord({
        isPrivate: !goal.is_shared,
        createdBy: String(goal.created_by),
        userId: ctx.session.user.id,
      })
    ) {
      throw new ForbiddenError('Access to private goal history is denied');
    }

    const { data, error } = await ctx.supabase
      .from('savings_contributions')
      .select(
        'id, amount, currency, direction, notes, occurred_at, created_at, account:accounts(id, name)',
      )
      .eq('goal_id', id)
      .eq('workspace_id', ctx.workspace.id)
      .order('occurred_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(`Failed to fetch goal history: ${error.message}`);

    const history = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const acc = (Array.isArray(row.account) ? row.account[0] : row.account) as {
        name?: string;
      } | null;
      return {
        id: row.id,
        amount: formatMoneyFixed4(row.amount as string | number),
        currency: row.currency,
        direction: row.direction,
        accountName: acc?.name ?? '',
        notes: row.notes,
        occurredAt: row.occurred_at,
      };
    });

    sendJson(res, 200, { history });
    return;
  }

  // POST /api/goals/:id/contribute — Posts atomic ledger transaction + updates goal
  if (id && action === 'contribute' && req.method === 'POST') {
    if (!z.string().uuid().safeParse(id).success) throw new BadRequestError('Invalid goal ID');

    const ctx = await authenticateFinanceRequest(req, {
      allowedRoles: WRITE_ROLES,
      rateLimitKey: 'goals:contribute',
    });

    const parsed = ContributeGoalSchema.safeParse(parseJsonBody(req));
    if (!parsed.success) {
      throw new ValidationError('Invalid contribution payload', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const amount = formatMoneyFixed4(parsePositiveMoney(parsed.data.amount, 'amount'));

    const [{ data: goal }, { data: account }] = await Promise.all([
      ctx.supabase
        .from('savings_goals')
        .select('id, name, target_amount, current_amount, currency, status, is_shared, created_by')
        .eq('id', id)
        .eq('workspace_id', ctx.workspace.id)
        .maybeSingle(),
      ctx.supabase
        .from('accounts')
        .select('id, workspace_id, owner_user_id, visibility, allowed_member_ids, currency, is_archived')
        .eq('id', parsed.data.accountId)
        .eq('workspace_id', ctx.workspace.id)
        .maybeSingle(),
    ]);

    if (!goal) throw new NotFoundError('Savings goal not found');
    if (
      !canUserAccessScopedRecord({
        isPrivate: !goal.is_shared,
        createdBy: String(goal.created_by),
        userId: ctx.session.user.id,
      })
    ) {
      throw new ForbiddenError('Cannot contribute to another member private goal');
    }
    if (!account) throw new NotFoundError('Account not found');
    assertAccountAccessible(
      account as AccountAccessRecord,
      ctx.session.user.id,
      ctx.workspace.id,
    );

    const currentDec = new Decimal(goal.current_amount as string | number);
    const amountDec = new Decimal(amount);
    if (parsed.data.direction === 'withdrawal' && amountDec.gt(currentDec)) {
      throw new ValidationError('Withdrawal exceeds current goal savings');
    }

    const nextDec =
      parsed.data.direction === 'deposit' ? currentDec.plus(amountDec) : currentDec.minus(amountDec);
    const targetDec = new Decimal(goal.target_amount as string | number);
    const nextStatus = nextDec.gte(targetDec) ? 'completed' : 'active';

    const { data: txRows, error: txErr } = await ctx.supabase.rpc('post_transaction_atomic', {
      p_workspace_id: ctx.workspace.id,
      p_account_id: parsed.data.accountId,
      p_category_id: null,
      p_created_by: ctx.session.user.id,
      p_type:
        parsed.data.direction === 'deposit' ? 'savings_contribution' : 'savings_withdrawal',
      p_amount: amount,
      p_reporting_currency: goal.currency,
      p_exchange_rate_used: 1,
      p_reporting_amount: amount,
      p_exchange_rate_id: null,
      p_occurred_at: new Date().toISOString(),
      p_description: `${goal.name} (${parsed.data.direction})`,
      p_notes: parsed.data.notes ?? null,
      p_tags: ['savings-goal'],
      p_is_private: false,
      p_idempotency_key: ctx.idempotencyKey,
      p_adjustment_direction: 'credit',
    });

    if (txErr || !Array.isArray(txRows) || txRows.length === 0) {
      throw new BadRequestError(txErr?.message ?? 'Failed to post savings transaction');
    }

    const txId = (txRows[0] as { transaction_id: string }).transaction_id;

    await Promise.all([
      ctx.supabase.from('savings_contributions').insert({
        workspace_id: ctx.workspace.id,
        goal_id: id,
        account_id: parsed.data.accountId,
        transaction_id: txId,
        created_by: ctx.session.user.id,
        amount,
        currency: account.currency,
        direction: parsed.data.direction,
        notes: parsed.data.notes ?? null,
      }),
      ctx.supabase
        .from('savings_goals')
        .update({
          current_amount: formatMoneyFixed4(nextDec),
          status: nextStatus,
        })
        .eq('id', id),
    ]);

    const pct = targetDec.gt(0) ? nextDec.div(targetDec).times(100).toNumber() : 0;
    for (const milestone of [50, 100]) {
      if (pct >= milestone) {
        void dispatchWorkspaceNotification({
          supabase: ctx.supabase,
          workspaceId: ctx.workspace.id,
          userId: ctx.session.user.id,
          telegramId: ctx.session.user.telegramId,
          type: 'goal_milestone',
          title: `${String(goal.name)} — ${milestone}%`,
          body: `${formatMoneyFixed4(nextDec)} / ${formatMoneyFixed4(targetDec)} ${String(goal.currency)}`,
          dedupeKey: `goal:${id}:${milestone}`,
        });
      }
    }

    sendJson(res, 200, {
      goalId: id,
      transactionId: txId,
      currentAmount: formatMoneyFixed4(nextDec),
      status: nextStatus,
    });
    return;
  }

  throw new NotFoundError('Savings goal endpoint not found');
});
