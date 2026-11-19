import { motion } from 'framer-motion';
import { AlertCircle, ExternalLink, Loader2, Lock, RefreshCw, Send, Shield } from 'lucide-react';
import { GlassBadge } from '@/components/glass/GlassBadge';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';

export function AuthGatePage() {
  const { status, errorCode, retryAuthentication } = useAuth();
  const { t } = useI18n();

  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
  const telegramBotUrl =
    botUsername && botUsername !== 'your_finora_bot'
      ? `https://t.me/${botUsername}`
      : 'https://telegram.org';

  if (status === 'initializing') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <GlassCard padding="lg" className="text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-500 dark:text-blue-400">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {t.auth.verifyingTitle}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {t.auth.verifyingSubtitle}
            </p>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  if (status === 'error') {
    const localizedError =
      errorCode === 'RATE_LIMITED'
        ? t.errors.rateLimited
        : errorCode === 'FORBIDDEN'
          ? t.errors.forbidden
          : errorCode === 'NETWORK_ERROR'
            ? t.errors.network
            : t.auth.verificationFailed;

    return (
      <div className="flex flex-1 items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <GlassCard padding="lg" className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-500">
              <AlertCircle className="h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {t.auth.verificationFailed}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{localizedError}</p>
            <div className="mt-6 flex justify-center">
              <GlassButton onClick={() => void retryAuthentication()} size="lg">
                <RefreshCw className="h-4 w-4" />
                {t.auth.tryAgain}
              </GlassButton>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-lg"
      >
        <GlassCard padding="lg">
          <div className="flex flex-col items-center text-center">
            <GlassBadge tone="blue" className="mb-4">
              <Shield className="h-3.5 w-3.5" />
              {t.app.zeroCostBadge}
            </GlassBadge>

            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 via-violet-600 to-emerald-500 text-white shadow-glow-blue">
              <Send className="h-8 w-8" />
            </div>

            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {t.auth.openInTelegramTitle}
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {t.auth.openInTelegramSubtitle}
            </p>

            <div className="mt-6 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
              <a
                href={telegramBotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-600 px-6 py-3.5 text-sm font-semibold text-white shadow-glow-blue transition hover:brightness-110"
              >
                <ExternalLink className="h-4 w-4" />
                {t.auth.openTelegramButton}
              </a>

              <GlassButton
                variant="secondary"
                size="lg"
                onClick={() => void retryAuthentication()}
              >
                <RefreshCw className="h-4 w-4" />
                {t.common.retry}
              </GlassButton>
            </div>

            <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-slate-300/40 bg-slate-900/[0.03] p-3.5 text-left text-xs text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <span>{t.auth.securityNote}</span>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}
