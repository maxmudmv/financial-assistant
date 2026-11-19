import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  authenticateWithTelegram,
  fetchActiveSession,
  logoutSession,
  switchActiveWorkspace,
} from '@/services/authService';
import {
  getTelegramInitData,
  initTelegramWebApp,
  isInsideTelegramMiniApp,
  triggerHaptic,
} from '@/lib/telegram';
import { ApiClientError } from '@/lib/apiClient';
import type {
  AuthSessionResponse,
  AuthenticatedUserProfile,
  AuthenticatedUserSettings,
  AuthorizedWorkspace,
} from '@/types/auth';
import { useI18n } from '@/i18n/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';

export type AuthStatus =
  | 'initializing'
  | 'authenticated'
  | 'outside_telegram'
  | 'unauthenticated'
  | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedUserProfile | null;
  settings: AuthenticatedUserSettings | null;
  activeWorkspace: AuthorizedWorkspace | null;
  workspaces: AuthorizedWorkspace[];
  sessionExpiresAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  isSwitchingWorkspace: boolean;
  retryAuthentication: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  patchLocalSettings: (partial: Partial<AuthenticatedUserSettings>) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLanguage } = useI18n();
  const { setTheme } = useTheme();

  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [sessionData, setSessionData] = useState<AuthSessionResponse | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);

  const hydrateSession = useCallback(
    (data: AuthSessionResponse) => {
      setSessionData(data);
      setStatus('authenticated');
      setErrorCode(null);
      setErrorMessage(null);
      if (data.settings?.language) {
        setLanguage(data.settings.language);
      }
      if (data.settings?.theme) {
        setTheme(data.settings.theme);
      }
    },
    [setLanguage, setTheme],
  );

  const bootstrapAuth = useCallback(async () => {
    setStatus('initializing');
    setErrorCode(null);
    setErrorMessage(null);

    initTelegramWebApp();
    const initData = getTelegramInitData();

    // 1. Inside Telegram Mini App -> verify cryptographic initData with backend
    if (initData.length > 0) {
      try {
        const verified = await authenticateWithTelegram(initData);
        hydrateSession(verified);
        triggerHaptic('success');
        return;
      } catch (err) {
        triggerHaptic('error');
        if (err instanceof ApiClientError) {
          setErrorCode(err.code);
          setErrorMessage(err.message);
        } else {
          setErrorCode('NETWORK_ERROR');
          setErrorMessage('Network error');
        }
        setStatus('error');
        return;
      }
    }

    // 2. Outside Telegram -> check if a valid HttpOnly server session cookie already exists
    try {
      const existing = await fetchActiveSession();
      hydrateSession(existing);
    } catch {
      setSessionData(null);
      setStatus(isInsideTelegramMiniApp() ? 'unauthenticated' : 'outside_telegram');
    }
  }, [hydrateSession]);

  useEffect(() => {
    void bootstrapAuth();
  }, [bootstrapAuth]);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!sessionData || sessionData.activeWorkspace.id === workspaceId) return;
      setIsSwitchingWorkspace(true);
      try {
        const updated = await switchActiveWorkspace(workspaceId);
        setSessionData((prev) =>
          prev
            ? {
                ...prev,
                activeWorkspace: updated.activeWorkspace,
                workspaces: updated.workspaces,
                settings: {
                  ...prev.settings,
                  activeWorkspaceId: updated.activeWorkspace.id,
                },
              }
            : null,
        );
        triggerHaptic('light');
      } finally {
        setIsSwitchingWorkspace(false);
      }
    },
    [sessionData],
  );

  const patchLocalSettings = useCallback((partial: Partial<AuthenticatedUserSettings>) => {
    setSessionData((prev) =>
      prev
        ? {
            ...prev,
            settings: {
              ...prev.settings,
              ...partial,
            },
          }
        : null,
    );
  }, []);

  const logout = useCallback(async () => {
    await logoutSession();
    setSessionData(null);
    setStatus(isInsideTelegramMiniApp() ? 'unauthenticated' : 'outside_telegram');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: sessionData?.user ?? null,
      settings: sessionData?.settings ?? null,
      activeWorkspace: sessionData?.activeWorkspace ?? null,
      workspaces: sessionData?.workspaces ?? [],
      sessionExpiresAt: sessionData?.session.expiresAt ?? null,
      errorCode,
      errorMessage,
      isSwitchingWorkspace,
      retryAuthentication: bootstrapAuth,
      switchWorkspace,
      patchLocalSettings,
      logout,
    }),
    [
      status,
      sessionData,
      errorCode,
      errorMessage,
      isSwitchingWorkspace,
      bootstrapAuth,
      switchWorkspace,
      patchLocalSettings,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
