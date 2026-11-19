import type { SupabaseClient } from '@supabase/supabase-js';
import { RateLimitError } from './errors.js';

export interface RateLimitResult {
  allowed: boolean;
  currentHits: number;
  limit: number;
  resetAt: Date;
}

interface MemoryBucket {
  hits: number;
  expiresAtMs: number;
}

const memoryBuckets = new Map<string, MemoryBucket>();

/**
 * In-memory fixed-window rate limiter used for isolated tests and fallback when
 * database RPC is unavailable.
 */
export function checkMemoryRateLimit(
  bucketKey: string,
  limit: number,
  windowSeconds: number,
  nowMs = Date.now(),
): RateLimitResult {
  const existing = memoryBuckets.get(bucketKey);

  if (!existing || existing.expiresAtMs <= nowMs) {
    const expiresAtMs = nowMs + windowSeconds * 1000;
    memoryBuckets.set(bucketKey, { hits: 1, expiresAtMs });
    return {
      allowed: 1 <= limit,
      currentHits: 1,
      limit,
      resetAt: new Date(expiresAtMs),
    };
  }

  existing.hits += 1;
  memoryBuckets.set(bucketKey, existing);

  return {
    allowed: existing.hits <= limit,
    currentHits: existing.hits,
    limit,
    resetAt: new Date(existing.expiresAtMs),
  };
}

export function clearMemoryRateLimits(): void {
  memoryBuckets.clear();
}

/**
 * Serverless-safe rate limit check backed by PostgreSQL `check_rate_limit` RPC
 * (zero-cost alternative to Redis) with automatic fallback to in-memory limiter.
 */
export async function enforceRateLimit(options: {
  supabase?: SupabaseClient | null;
  bucketKey: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const { supabase, bucketKey, limit, windowSeconds } = options;
  let result: RateLimitResult;

  if (supabase) {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_bucket_key: bucketKey,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (!error && Array.isArray(data) && data.length > 0) {
      const row = data[0] as { allowed: boolean; current_hits: number; reset_at: string };
      result = {
        allowed: Boolean(row.allowed),
        currentHits: Number(row.current_hits),
        limit,
        resetAt: new Date(row.reset_at),
      };
    } else {
      result = checkMemoryRateLimit(bucketKey, limit, windowSeconds);
    }
  } else {
    result = checkMemoryRateLimit(bucketKey, limit, windowSeconds);
  }

  if (!result.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
    );
    throw new RateLimitError(retryAfterSeconds);
  }

  return result;
}
