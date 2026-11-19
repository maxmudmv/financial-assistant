import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Database,
  KeyRound,
  Layers,
  LogOut,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { GlassBadge } from '@/components/glass/GlassBadge';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime } from '@/i18n/formatters';
import { useI18n } from '@/i18n/I18nContext';
import { cn } from '@/lib/cn';

export function FoundationShellPage() {
  const {
    user,
    activeWorkspace,
    workspaces,
    sessionExpiresAt,
    isSwitchingWorkspace,
    switchWorkspace,
    logout,
  } = useAuth();
  const { language, t } = useI18n();

  if (!user || !activeWorkspace) return null;

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');

  const foundationChecks = [
    { icon: Layers, label: t.foundation.architectureReady },
    { icon: Database, label: t.foundation.databaseReady },
    { icon: KeyRound, label: t.foundation.authReady },
    { icon: ShieldCheck, label: t.foundation.rlsActive },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-5"
    >
      {/* Verified Identity & Session Header */}
      <GlassCard padding="lg">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            {user.photoUrl ? (
              <img
                src={user.photoUrl}
                alt={fullName}
                className="h-14 w-14 rounded-2xl border border-white/25 object-cover shadow-md"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-violet-500 to-emerald-500 text-lg font-bold text-white shadow-glow-blue">
                {user.firstName.slice(0, 1).toUpperCase()}
              </div>
            )}

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
                  {fullName}
                </h1>
                <GlassBadge tone="emerald">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t.auth.authenticatedBadge}
                </GlassBadge>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {user.username ? `@${user.username}` : t.auth.telegramVerified}
                {sessionExpiresAt
                  ? ` • ${t.auth.sessionExpiresLabel}: ${formatDateTime(sessionExpiresAt, language)}`
                  : ''}
              </p>
            </div>
          </div>

          <GlassButton variant="danger" size="sm" onClick={() => void logout()}>
            <LogOut className="h-3.5 w-3.5" />
            {t.common.logout}
          </GlassButton>
        </div>
      </GlassCard>

      {/* Authorized Workspaces Switcher */}
      <GlassCard>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t.workspace.title}
          </h2>
          <GlassBadge tone="blue">
            {t.workspace.currencyLabel}: {activeWorkspace.defaultCurrency}
          </GlassBadge>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((ws) => {
            const isActive = ws.id === activeWorkspace.id;
            const WorkspaceIcon = ws.type === 'family' ? Users : User;
            return (
              <button
                key={ws.id}
                type="button"
                disabled={isSwitchingWorkspace}
                onClick={() => void switchWorkspace(ws.id)}
                className={cn(
                  'flex items-center justify-between rounded-2xl border p-4 text-left transition-all',
                  isActive
                    ? 'border-blue-500/60 bg-blue-500/10 shadow-glow-blue'
                    : 'border-slate-300/40 bg-slate-900/[0.02] hover:border-blue-400/40 dark:border-white/10 dark:bg-white/[0.03]',
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-xl',
                      isActive
                        ? 'bg-blue-500 text-white'
                        : 'bg-slate-200/80 text-slate-700 dark:bg-white/10 dark:text-slate-200',
                    )}
                  >
                    <WorkspaceIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{ws.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {ws.type === 'family' ? t.workspace.family : t.workspace.personal} •{' '}
                      {t.workspace.roles[ws.role]}
                    </p>
                  </div>
                </div>

                {isActive && <GlassBadge tone="emerald">{t.workspace.activeLabel}</GlassBadge>}
              </button>
            );
          })}
        </div>
      </GlassCard>

      {/* Foundation Status Summary */}
      <GlassCard>
        <h2 className="text-base font-bold text-slate-900 dark:text-white">
          {t.foundation.title}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {t.foundation.subtitle}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {foundationChecks.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-2xl border border-slate-300/35 bg-slate-900/[0.02] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div className="flex items-center gap-2.5">
                <Icon className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {label}
                </span>
              </div>
              <GlassBadge tone="emerald">{t.common.statusReady}</GlassBadge>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          {t.foundation.nextPhaseNote}
        </p>
      </GlassCard>
    </motion.div>
  );
}
