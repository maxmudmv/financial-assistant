import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConflictError } from '../security/errors';

export function computeRequestPayloadHash(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeJson(v)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(',')}}`;
}

export interface IdempotencyCheckResult {
  hit: boolean;
  statusCode?: number;
  responseBody?: unknown;
}

export async function checkApiIdempotency(options: {
  supabase: SupabaseClient;
  userId: string;
  idempotencyKey: string;
  requestPath: string;
  requestHash: string;
}): Promise<IdempotencyCheckResult> {
  const { data, error } = await options.supabase
    .from('idempotency_keys')
    .select('request_hash, response_status, response_body, expires_at')
    .eq('user_id', options.userId)
    .eq('idempotency_key', options.idempotencyKey)
    .eq('request_path', options.requestPath)
    .maybeSingle();

  if (error || !data) {
    return { hit: false };
  }

  if (new Date(data.expires_at as string).getTime() <= Date.now()) {
    return { hit: false };
  }

  if (data.request_hash !== options.requestHash) {
    throw new ConflictError('Idempotency key was already used with a different request payload');
  }

  if (data.response_status !== null && data.response_body !== null) {
    return {
      hit: true,
      statusCode: Number(data.response_status),
      responseBody: data.response_body,
    };
  }

  return { hit: false };
}

export async function storeApiIdempotency(options: {
  supabase: SupabaseClient;
  workspaceId: string;
  userId: string;
  idempotencyKey: string;
  requestMethod: string;
  requestPath: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  ttlHours?: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + (options.ttlHours ?? 24) * 3600 * 1000).toISOString();
  await options.supabase.from('idempotency_keys').upsert(
    {
      workspace_id: options.workspaceId,
      user_id: options.userId,
      idempotency_key: options.idempotencyKey,
      request_method: options.requestMethod,
      request_path: options.requestPath,
      request_hash: options.requestHash,
      response_status: options.responseStatus,
      response_body: options.responseBody,
      expires_at: expiresAt,
    },
    { onConflict: 'user_id,idempotency_key,request_path' },
  );
}
