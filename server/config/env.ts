import { z } from 'zod';

const ServerEnvSchema = z.object({
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  TELEGRAM_BOT_TOKEN: z.string().min(10, 'TELEGRAM_BOT_TOKEN is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2592000).default(604800),
  TELEGRAM_AUTH_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(86400).default(300),
  APP_URL: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = ServerEnvSchema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    SESSION_SECRET: process.env.SESSION_SECRET,
    SESSION_TTL_SECONDS: process.env.SESSION_TTL_SECONDS,
    TELEGRAM_AUTH_MAX_AGE_SECONDS: process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS,
    APP_URL: process.env.APP_URL || undefined,
    NODE_ENV: process.env.NODE_ENV || 'production',
    VERCEL_ENV: process.env.VERCEL_ENV || undefined,
  });

  if (!parsed.success) {
    const missingKeys = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Missing or invalid server environment configuration: ${missingKeys}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function getConfigReadiness(): {
  supabaseConfigured: boolean;
  telegramConfigured: boolean;
  sessionConfigured: boolean;
} {
  return {
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    sessionConfigured: Boolean(
      process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32,
    ),
  };
}

export function resetCachedEnvForTests(): void {
  cachedEnv = null;
}
