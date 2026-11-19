import { describe, expect, it } from 'vitest';
import {
  mapTelegramLanguage,
  signTelegramInitDataForTests,
  verifyTelegramInitData,
} from '../../server/auth/telegram';
import { UnauthorizedError } from '../../server/security/errors';

const TEST_BOT_TOKEN = '123456789:TEST_TOKEN_FOR_FINORA_HMAC_VERIFICATION_ONLY';

describe('Telegram initData cryptographic verification', () => {
  it('accepts a validly signed initData payload with fresh auth_date', () => {
    const now = 1_760_000_000;
    const raw = signTelegramInitDataForTests(
      {
        auth_date: String(now - 30),
        query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
        user: JSON.stringify({
          id: 777123456,
          first_name: 'Aziz',
          last_name: 'Karimov',
          username: 'aziz_k',
          language_code: 'uz',
        }),
      },
      TEST_BOT_TOKEN,
    );

    const verified = verifyTelegramInitData(raw, {
      botToken: TEST_BOT_TOKEN,
      maxAgeSeconds: 300,
      nowUnixSeconds: now,
    });

    expect(verified.user).toEqual({
      telegramId: 777123456,
      firstName: 'Aziz',
      lastName: 'Karimov',
      username: 'aziz_k',
      languageCode: 'uz',
      photoUrl: null,
    });
    expect(verified.authDateUnix).toBe(now - 30);
    expect(verified.queryId).toBe('AAHdF6IQAAAAAN0XohDhrOrc');
  });

  it('rejects tampered user ID even if original hash is preserved', () => {
    const now = 1_760_000_000;
    const validRaw = signTelegramInitDataForTests(
      {
        auth_date: String(now - 10),
        user: JSON.stringify({ id: 1001, first_name: 'Alice' }),
      },
      TEST_BOT_TOKEN,
    );

    const tampered = validRaw.replace('1001', '9999');

    expect(() =>
      verifyTelegramInitData(tampered, {
        botToken: TEST_BOT_TOKEN,
        nowUnixSeconds: now,
      }),
    ).toThrowError(UnauthorizedError);
  });

  it('rejects initData signed with a different bot token', () => {
    const now = 1_760_000_000;
    const forged = signTelegramInitDataForTests(
      {
        auth_date: String(now - 5),
        user: JSON.stringify({ id: 1001, first_name: 'Mallory' }),
      },
      '987654321:WRONG_BOT_TOKEN_FOR_FORGERY_TEST',
    );

    expect(() =>
      verifyTelegramInitData(forged, {
        botToken: TEST_BOT_TOKEN,
        nowUnixSeconds: now,
      }),
    ).toThrowError(UnauthorizedError);
  });

  it('rejects expired auth_date beyond maxAgeSeconds', () => {
    const now = 1_760_000_000;
    const stale = signTelegramInitDataForTests(
      {
        auth_date: String(now - 301),
        user: JSON.stringify({ id: 1001, first_name: 'Alice' }),
      },
      TEST_BOT_TOKEN,
    );

    expect(() =>
      verifyTelegramInitData(stale, {
        botToken: TEST_BOT_TOKEN,
        maxAgeSeconds: 300,
        nowUnixSeconds: now,
      }),
    ).toThrowError(UnauthorizedError);
  });

  it('rejects future auth_date beyond allowed clock skew', () => {
    const now = 1_760_000_000;
    const future = signTelegramInitDataForTests(
      {
        auth_date: String(now + 120),
        user: JSON.stringify({ id: 1001, first_name: 'Alice' }),
      },
      TEST_BOT_TOKEN,
    );

    expect(() =>
      verifyTelegramInitData(future, {
        botToken: TEST_BOT_TOKEN,
        maxFutureSkewSeconds: 60,
        nowUnixSeconds: now,
      }),
    ).toThrowError(UnauthorizedError);
  });

  it('rejects bot accounts attempting to authenticate', () => {
    const now = 1_760_000_000;
    const botInitData = signTelegramInitDataForTests(
      {
        auth_date: String(now - 5),
        user: JSON.stringify({ id: 42, first_name: 'SomeBot', is_bot: true }),
      },
      TEST_BOT_TOKEN,
    );

    expect(() =>
      verifyTelegramInitData(botInitData, {
        botToken: TEST_BOT_TOKEN,
        nowUnixSeconds: now,
      }),
    ).toThrowError(UnauthorizedError);
  });

  it('maps unknown or missing Telegram language codes to Uzbek default', () => {
    expect(mapTelegramLanguage('ru-RU')).toBe('ru');
    expect(mapTelegramLanguage('en-GB')).toBe('en');
    expect(mapTelegramLanguage('uz')).toBe('uz');
    expect(mapTelegramLanguage('de')).toBe('uz');
    expect(mapTelegramLanguage(undefined)).toBe('uz');
  });
});
