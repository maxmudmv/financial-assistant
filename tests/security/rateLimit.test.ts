import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkMemoryRateLimit,
  clearMemoryRateLimits,
  enforceRateLimit,
} from '../../server/security/rateLimit';
import { RateLimitError } from '../../server/security/errors';

describe('Serverless rate limiting', () => {
  beforeEach(() => {
    clearMemoryRateLimits();
  });

  it('allows requests up to the limit and rejects excess hits within window', async () => {
    const bucketKey = 'auth:telegram:203.0.113.10';

    for (let i = 1; i <= 3; i += 1) {
      const res = await enforceRateLimit({
        supabase: null,
        bucketKey,
        limit: 3,
        windowSeconds: 60,
      });
      expect(res.allowed).toBe(true);
      expect(res.currentHits).toBe(i);
    }

    await expect(
      enforceRateLimit({
        supabase: null,
        bucketKey,
        limit: 3,
        windowSeconds: 60,
      }),
    ).rejects.toThrowError(RateLimitError);
  });

  it('resets the hit counter once the window expires and isolates separate keys', () => {
    const start = 1_760_000_000_000;

    expect(checkMemoryRateLimit('ip-a', 1, 60, start).allowed).toBe(true);
    expect(checkMemoryRateLimit('ip-a', 1, 60, start + 1_000).allowed).toBe(false);
    // Different key remains unaffected
    expect(checkMemoryRateLimit('ip-b', 1, 60, start + 1_000).allowed).toBe(true);
    // Original key resets after window passes
    expect(checkMemoryRateLimit('ip-a', 1, 60, start + 61_000).allowed).toBe(true);
  });
});
