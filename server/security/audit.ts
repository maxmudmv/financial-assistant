import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditEventInput {
  workspaceId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an immutable audit log record to PostgreSQL `audit_logs`.
 * Failures are captured cleanly so security logging never leaks secrets or crashes auth flows.
 */
export async function recordAuditLog(
  supabase: SupabaseClient,
  event: AuditEventInput,
): Promise<void> {
  try {
    const safeIp = isValidIp(event.ipAddress) ? event.ipAddress : null;
    const { error } = await supabase.from('audit_logs').insert({
      workspace_id: event.workspaceId ?? null,
      actor_user_id: event.actorUserId ?? null,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId ?? null,
      ip_address: safeIp,
      user_agent: event.userAgent ? event.userAgent.slice(0, 500) : null,
      metadata: event.metadata ?? {},
    });

    if (error) {
      console.warn('[FINORA AUDIT] Failed to persist audit log:', error.code);
    }
  } catch {
    console.warn('[FINORA AUDIT] Unexpected audit log write failure');
  }
}

function isValidIp(value?: string | null): value is string {
  if (!value) return false;
  // Basic IPv4 / IPv6 sanity check for PostgreSQL INET column
  return /^[0-9a-fA-F:.]+$/.test(value);
}
