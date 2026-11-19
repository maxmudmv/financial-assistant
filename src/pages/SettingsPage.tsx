import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  BookOpenCheck,
  Download,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  LogOut,
  Printer,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { GlassBadge } from '@/components/glass/GlassBadge';
import { GlassButton } from '@/components/glass/GlassButton';
import { GlassCard } from '@/components/glass/GlassCard';
import { GlassSelect } from '@/components/glass/GlassSelect';
import { LanguageSwitcher } from '@/components/glass/LanguageSwitcher';
import { ThemeToggle } from '@/components/glass/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/i18n/I18nContext';
import {
  acceptWorkspaceInvite,
  createFamilyWorkspace,
  createWorkspaceInvite,
  deleteUserAccount,
  downloadReportExport,
  fetchUserSettings,
  fetchWorkspaceMembers,
  removeWorkspaceMember,
  updateMemberRole,
  updateUserSettings,
} from '@/services/planningService';

const CURRENCIES = ['UZS', 'USD', 'EUR', 'RUB', 'GBP'];

export function SettingsPage() {
  const {
    user,
    activeWorkspace,
    workspaces,
    switchWorkspace,
    patchLocalSettings,
    retryAuthentication,
    logout,
  } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const workspaceId = activeWorkspace?.id ?? '';

  const [familyName, setFamilyName] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'read_only'>('member');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [joinToken, setJoinToken] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['user-settings', workspaceId],
    queryFn: () => fetchUserSettings(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const membersQuery = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => fetchWorkspaceMembers(workspaceId),
    enabled: Boolean(workspaceId),
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => updateUserSettings(workspaceId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user-settings', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['analytics', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['accounts', workspaceId] });
    },
  });

  const createFamilyMutation = useMutation({
    mutationFn: () =>
      createFamilyWorkspace({
        name: familyName,
        defaultCurrency: activeWorkspace?.defaultCurrency ?? 'UZS',
      }),
    onSuccess: async () => {
      setFamilyName('');
      await retryAuthentication();
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: () => createWorkspaceInvite(workspaceId, { role: inviteRole }),
    onSuccess: (res) => {
      setGeneratedToken(res.inviteToken);
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: () => acceptWorkspaceInvite(joinToken),
    onSuccess: async () => {
      setJoinToken('');
      setStatusMessage('Joined family workspace');
      await retryAuthentication();
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({
      memberId,
      role,
    }: {
      memberId: string;
      role: 'admin' | 'member' | 'read_only';
    }) => updateMemberRole(workspaceId, memberId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => removeWorkspaceMember(workspaceId, memberId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: () => deleteUserAccount(workspaceId),
    onSuccess: () => void logout(),
  });

  const currentSettings = settingsQuery.data?.settings;
  const currentPrefs = settingsQuery.data?.notificationPreferences;
  const isAdminOrOwner = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {t.settings.title}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t.settings.subtitle}</p>
      </div>

      {/* User Profile & Logout */}
      {user && (
        <GlassCard>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-lg font-extrabold text-slate-900 dark:text-white">
                {[user.firstName, user.lastName].filter(Boolean).join(' ')}
              </p>
              <p className="text-xs text-slate-500">
                {user.username ? `@${user.username}` : t.auth.telegramVerified}
              </p>
            </div>
            <GlassButton variant="danger" size="sm" onClick={() => void logout()}>
              <LogOut className="h-4 w-4" />
              {t.common.logout}
            </GlassButton>
          </div>
        </GlassCard>
      )}

      {/* Preferences (Language, Theme, Reporting Currency, Privacy, Telegram Alerts) */}
      <GlassCard>
        <h2 className="mb-4 text-base font-bold text-slate-900 dark:text-white">
          {t.settings.preferencesTitle}
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t.language.label}
            </span>
            <LanguageSwitcher
              onChange={(nextLang) => {
                patchLocalSettings({ language: nextLang });
                updateSettingsMutation.mutate({ language: nextLang });
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t.theme.label}
            </span>
            <ThemeToggle
              onChange={(nextTheme) => {
                patchLocalSettings({ theme: nextTheme });
                updateSettingsMutation.mutate({ theme: nextTheme });
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {t.settings.reportingCurrency}
            </span>
            <GlassSelect
              label={t.settings.reportingCurrency}
              value={currentSettings?.reportingCurrency ?? activeWorkspace?.defaultCurrency ?? 'UZS'}
              onChange={(nextCurr) => {
                patchLocalSettings({ reportingCurrency: nextCurr });
                updateSettingsMutation.mutate({ reportingCurrency: nextCurr });
              }}
              className="w-28"
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </div>

          <label className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <EyeOff className="h-3.5 w-3.5" />
              {t.settings.hideBalances}
            </span>
            <input
              type="checkbox"
              checked={Boolean(currentSettings?.hideBalances)}
              onChange={(e) => {
                patchLocalSettings({ hideBalances: e.target.checked });
                updateSettingsMutation.mutate({ hideBalances: e.target.checked });
              }}
            />
          </label>

          <label className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span>{t.settings.telegramAlerts}</span>
            <input
              type="checkbox"
              checked={currentPrefs?.telegram_enabled !== false}
              onChange={(e) =>
                updateSettingsMutation.mutate({
                  notificationPreferences: { telegramEnabled: e.target.checked },
                })
              }
            />
          </label>
        </div>
      </GlassCard>

      {/* Family Workspace & Members */}
      <GlassCard>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-500" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t.settings.familyTitle}
            </h2>
          </div>
          {activeWorkspace && (
            <GlassBadge tone="blue">{t.workspace.roles[activeWorkspace.role]}</GlassBadge>
          )}
        </div>

        {/* Workspace Switcher */}
        <div className="mb-4 flex flex-wrap gap-2">
          {workspaces.map((ws) => (
            <GlassButton
              key={ws.id}
              size="sm"
              variant={ws.id === activeWorkspace?.id ? 'primary' : 'secondary'}
              onClick={() => void switchWorkspace(ws.id)}
            >
              {ws.name} ({ws.type === 'family' ? t.workspace.family : t.workspace.personal})
            </GlassButton>
          ))}
        </div>

        {/* Create Family Workspace */}
        <div className="mb-4 flex gap-2">
          <input
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            placeholder={t.settings.familyName}
            className="w-full rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
          />
          <GlassButton
            size="sm"
            disabled={!familyName || createFamilyMutation.isPending}
            onClick={() => createFamilyMutation.mutate()}
          >
            {t.settings.createFamily}
          </GlassButton>
        </div>

        {/* Members List */}
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          {t.settings.membersTitle}
        </h3>
        <div className="flex flex-col gap-2">
          {(membersQuery.data?.members ?? []).map((m) => (
            <div
              key={m.memberId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-300/30 px-3 py-2 text-xs dark:border-white/10"
            >
              <div>
                <p className="font-bold text-slate-900 dark:text-white">
                  {[m.firstName, m.lastName].filter(Boolean).join(' ')}
                </p>
                <p className="text-[11px] text-slate-500">
                  {m.username ? `@${m.username}` : m.userId.slice(0, 8)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isAdminOrOwner && m.role !== 'owner' ? (
                  <>
                    <GlassSelect
                      label={t.settings.membersTitle}
                      value={m.role}
                      onChange={(nextRole) =>
                        roleMutation.mutate({
                          memberId: m.memberId,
                          role: nextRole as 'admin' | 'member' | 'read_only',
                        })
                      }
                      className="w-36"
                      options={[
                        { value: 'admin', label: t.workspace.roles.admin },
                        { value: 'member', label: t.workspace.roles.member },
                        { value: 'read_only', label: t.workspace.roles.read_only },
                      ]}
                    />
                    <button
                      type="button"
                      onClick={() => removeMemberMutation.mutate(m.memberId)}
                      className="text-rose-500 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <GlassBadge>{t.workspace.roles[m.role]}</GlassBadge>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Invite Member (Family Admin/Owner) */}
        {activeWorkspace?.type === 'family' && isAdminOrOwner && (
          <div className="mt-4 rounded-2xl border border-slate-300/35 p-3.5 dark:border-white/10">
            <p className="mb-2 text-xs font-bold text-slate-900 dark:text-white">
              {t.settings.inviteMember}
            </p>
            <div className="flex flex-wrap gap-2">
              <GlassSelect
                label={t.settings.inviteMember}
                value={inviteRole}
                onChange={(nextRole) =>
                  setInviteRole(nextRole as 'admin' | 'member' | 'read_only')
                }
                className="w-40"
                options={[
                  { value: 'member', label: t.workspace.roles.member },
                  { value: 'admin', label: t.workspace.roles.admin },
                  { value: 'read_only', label: t.workspace.roles.read_only },
                ]}
              />
              <GlassButton size="sm" onClick={() => createInviteMutation.mutate()}>
                <UserPlus className="h-3.5 w-3.5" />
                {t.settings.generateInvite}
              </GlassButton>
            </div>
            {generatedToken && (
              <div className="mt-2 rounded-xl bg-blue-500/10 p-2.5 text-xs">
                <p className="text-slate-600 dark:text-slate-300">{t.settings.inviteTokenNotice}</p>
                <code className="mt-1 block break-all font-mono font-bold text-blue-500">
                  {generatedToken}
                </code>
              </div>
            )}
          </div>
        )}

        {/* Accept Family Invitation */}
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            value={joinToken}
            onChange={(e) => setJoinToken(e.target.value)}
            placeholder={t.settings.acceptInvitePlaceholder}
            className="flex-1 rounded-xl border border-slate-300/40 bg-white/70 px-3 py-2 text-xs dark:border-white/15 dark:bg-slate-900/60"
          />
          <GlassButton
            variant="secondary"
            size="sm"
            disabled={!joinToken || acceptInviteMutation.isPending}
            onClick={() => acceptInviteMutation.mutate()}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {t.settings.joinFamily}
          </GlassButton>
        </div>
        {statusMessage && <p className="mt-2 text-xs text-emerald-500">{statusMessage}</p>}
      </GlassCard>

      {/* Reports, Exports & Immutable Ledger Audit */}
      <GlassCard>
        <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
          {t.settings.reportsTitle}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/reports">
            <GlassButton size="sm">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {t.nav.reports}
            </GlassButton>
          </Link>
          <GlassButton
            variant="secondary"
            size="sm"
            onClick={() =>
              void downloadReportExport(workspaceId, {
                reportType: 'monthly',
                period: 'year',
                format: 'pdf',
              })
            }
          >
            <Printer className="h-3.5 w-3.5" />
            {t.reports.exportPdf}
          </GlassButton>
          <GlassButton
            variant="secondary"
            size="sm"
            onClick={() =>
              void downloadReportExport(workspaceId, {
                reportType: 'monthly',
                period: 'year',
                format: 'xlsx',
              })
            }
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {t.reports.exportXlsx}
          </GlassButton>
          <GlassButton
            variant="secondary"
            size="sm"
            onClick={() =>
              void downloadReportExport(workspaceId, {
                reportType: 'monthly',
                period: 'year',
                format: 'csv',
              })
            }
          >
            <Download className="h-3.5 w-3.5" />
            {t.reports.exportCsv}
          </GlassButton>
          <Link to="/ledger">
            <GlassButton variant="secondary" size="sm">
              <BookOpenCheck className="h-3.5 w-3.5" />
              {t.settings.ledgerAuditLink}
            </GlassButton>
          </Link>
        </div>
      </GlassCard>

      {/* Danger Zone: Account Deletion */}
      <GlassCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-rose-500">
            <ShieldAlert className="h-5 w-5" />
            <span className="text-sm font-bold">{t.settings.dangerZone}</span>
          </div>
          <GlassButton
            variant="danger"
            size="sm"
            onClick={() => {
              if (window.confirm(t.settings.deleteConfirm)) {
                deleteAccountMutation.mutate();
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t.settings.deleteAccount}
          </GlassButton>
        </div>
      </GlassCard>
    </div>
  );
}
