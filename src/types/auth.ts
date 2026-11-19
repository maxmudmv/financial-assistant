export type SupportedLanguage = 'uz' | 'ru' | 'en';
export type ThemePreference = 'system' | 'dark' | 'light';
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'read_only';
export type WorkspaceType = 'personal' | 'family';

export interface AuthorizedWorkspace {
  id: string;
  name: string;
  type: WorkspaceType;
  role: WorkspaceRole;
  defaultCurrency: string;
}

export interface AuthenticatedUserProfile {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  languageCode: SupportedLanguage;
  photoUrl: string | null;
}

export interface AuthenticatedUserSettings {
  language: SupportedLanguage;
  theme: ThemePreference;
  reportingCurrency: string;
  activeWorkspaceId: string | null;
  timezone: string;
  hideBalances: boolean;
}

export interface AuthSessionResponse {
  authenticated: true;
  sessionToken?: string;
  session: {
    id: string;
    expiresAt: string;
  };
  user: AuthenticatedUserProfile;
  settings: AuthenticatedUserSettings;
  activeWorkspace: AuthorizedWorkspace;
  workspaces: AuthorizedWorkspace[];
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  phase: string;
  timestamp: string;
  readiness: {
    supabaseConfigured: boolean;
    telegramConfigured: boolean;
    sessionConfigured: boolean;
  };
}
