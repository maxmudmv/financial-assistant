import crypto from 'node:crypto';
import { z } from 'zod';
import { UnauthorizedError } from '../security/errors.js';

export type SupportedLanguage = 'uz' | 'ru' | 'en';

const TelegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1).max(128),
  last_name: z.string().max(128).optional(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(16).optional(),
  photo_url: z.string().url().max(1024).optional(),
  is_bot: z.boolean().optional(),
});

export interface VerifiedTelegramUser {
  telegramId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: SupportedLanguage;
  photoUrl: string | null;
}

export interface VerifiedTelegramInitData {
  user: VerifiedTelegramUser;
  authDate: Date;
  authDateUnix: number;
  queryId: string | null;
  startParam: string | null;
}

export interface VerifyTelegramOptions {
  botToken: string;
  maxAgeSeconds?: number;
  maxFutureSkewSeconds?: number;
  nowUnixSeconds?: number;
}

const DEFAULT_MAX_AGE_SECONDS = 300;
const DEFAULT_FUTURE_SKEW_SECONDS = 60;

export function mapTelegramLanguage(rawCode?: string | null): SupportedLanguage {
  if (!rawCode) return 'uz';
  const normalized = rawCode.toLowerCase().trim();
  if (normalized.startsWith('ru')) return 'ru';
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('uz')) return 'uz';
  return 'uz';
}

/**
 * Cryptographically verifies Telegram Mini App `initData` per the official Telegram WebApp spec:
 *   secret_key = HMAC_SHA256("WebAppData", bot_token)
 *   expected_hash = hex(HMAC_SHA256(secret_key, sorted_data_check_string))
 * Uses constant-time comparison (`crypto.timingSafeEqual`) and strictly validates `auth_date`.
 */
export function verifyTelegramInitData(
  rawInitData: string,
  options: VerifyTelegramOptions,
): VerifiedTelegramInitData {
  if (typeof rawInitData !== 'string' || rawInitData.trim().length === 0) {
    throw new UnauthorizedError('Missing Telegram initData payload');
  }

  if (rawInitData.length > 8192) {
    throw new UnauthorizedError('Telegram initData payload exceeds allowed length');
  }

  if (!options.botToken || options.botToken.trim().length < 10) {
    throw new UnauthorizedError('Telegram bot authentication is not configured');
  }

  const params = new URLSearchParams(rawInitData);
  const receivedHash = params.get('hash');

  if (!receivedHash || !/^[0-9a-f]{64}$/i.test(receivedHash)) {
    throw new UnauthorizedError('Invalid or missing Telegram authentication signature');
  }

  // Build sorted data-check-string excluding `hash`
  const entries: Array<[string, string]> = [];
  params.forEach((value, key) => {
    if (key !== 'hash') {
      entries.push([key, value]);
    }
  });

  if (entries.length === 0) {
    throw new UnauthorizedError('Telegram initData payload is empty');
  }

  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(options.botToken)
    .digest();

  const computedHashHex = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const receivedBuf = Buffer.from(receivedHash.toLowerCase(), 'hex');
  const computedBuf = Buffer.from(computedHashHex, 'hex');

  if (receivedBuf.length !== computedBuf.length || !crypto.timingSafeEqual(receivedBuf, computedBuf)) {
    throw new UnauthorizedError('Telegram signature verification failed');
  }

  // Validate auth_date freshness & guard against replay / future timestamps
  const authDateRaw = params.get('auth_date');
  if (!authDateRaw || !/^\d+$/.test(authDateRaw)) {
    throw new UnauthorizedError('Missing or invalid Telegram auth_date');
  }

  const authDateUnix = Number.parseInt(authDateRaw, 10);
  const nowUnix = options.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const maxFutureSkew = options.maxFutureSkewSeconds ?? DEFAULT_FUTURE_SKEW_SECONDS;

  if (authDateUnix > nowUnix + maxFutureSkew) {
    throw new UnauthorizedError('Telegram auth_date is invalid (future timestamp)');
  }

  if (nowUnix - authDateUnix > maxAge) {
    throw new UnauthorizedError('Telegram authentication payload has expired');
  }

  // Parse and validate verified Telegram user JSON
  const userJsonRaw = params.get('user');
  if (!userJsonRaw) {
    throw new UnauthorizedError('Telegram initData is missing user identity');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(userJsonRaw);
  } catch {
    throw new UnauthorizedError('Telegram user payload is malformed JSON');
  }

  const parsedUser = TelegramUserSchema.safeParse(parsedJson);
  if (!parsedUser.success) {
    throw new UnauthorizedError('Telegram user payload failed validation');
  }

  if (parsedUser.data.is_bot) {
    throw new UnauthorizedError('Bot accounts are not permitted to sign in');
  }

  return {
    user: {
      telegramId: parsedUser.data.id,
      firstName: parsedUser.data.first_name,
      lastName: parsedUser.data.last_name ?? null,
      username: parsedUser.data.username ?? null,
      languageCode: mapTelegramLanguage(parsedUser.data.language_code),
      photoUrl: parsedUser.data.photo_url ?? null,
    },
    authDate: new Date(authDateUnix * 1000),
    authDateUnix,
    queryId: params.get('query_id'),
    startParam: params.get('start_param'),
  };
}

/**
 * Helper primarily for unit tests to build cryptographically signed Telegram initData strings.
 */
export function signTelegramInitDataForTests(
  payload: Record<string, string>,
  botToken: string,
): string {
  const entries = Object.entries(payload)
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const params = new URLSearchParams();
  for (const [k, v] of entries) {
    params.set(k, v);
  }
  params.set('hash', hash);
  return params.toString();
}
