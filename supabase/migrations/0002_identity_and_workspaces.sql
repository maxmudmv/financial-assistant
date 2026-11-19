-- ==============================================================================
-- FINORA Migration 0002: Users, User Settings, Sessions, Workspaces & Members
-- ==============================================================================

CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  language_code public.language_code NOT NULL DEFAULT 'uz',
  photo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_telegram_id ON public.users (telegram_id);
CREATE INDEX idx_users_username_lower ON public.users (lower(username)) WHERE username IS NOT NULL;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Workspaces (Personal or Family)
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  type public.workspace_type NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  default_currency CHAR(3) NOT NULL DEFAULT 'UZS' CHECK (default_currency ~ '^[A-Z]{3}$'),
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspaces_owner ON public.workspaces (owner_user_id);
CREATE UNIQUE INDEX idx_workspaces_single_personal_per_user
  ON public.workspaces (owner_user_id)
  WHERE type = 'personal' AND is_archived = false;

CREATE TRIGGER trg_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Workspace Membership & Roles
CREATE TABLE public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role public.workspace_role NOT NULL,
  invited_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user ON public.workspace_members (user_id);
CREATE INDEX idx_workspace_members_workspace_role ON public.workspace_members (workspace_id, role);

CREATE TRIGGER trg_workspace_members_updated_at
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Secure Tokenized Workspace Invitations
CREATE TABLE public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  invitee_telegram_username TEXT,
  role public.workspace_role NOT NULL DEFAULT 'member' CHECK (role <> 'owner'),
  token_hash TEXT NOT NULL UNIQUE,
  status public.invitation_status NOT NULL DEFAULT 'pending',
  max_uses INT NOT NULL DEFAULT 1 CHECK (max_uses >= 1 AND max_uses <= 25),
  use_count INT NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspace_invitations_workspace ON public.workspace_invitations (workspace_id, status);
CREATE INDEX idx_workspace_invitations_expires ON public.workspace_invitations (expires_at) WHERE status = 'pending';

CREATE TRIGGER trg_workspace_invitations_updated_at
  BEFORE UPDATE ON public.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- User Preferences & Settings
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  language public.language_code NOT NULL DEFAULT 'uz',
  theme public.theme_preference NOT NULL DEFAULT 'system',
  reporting_currency CHAR(3) NOT NULL DEFAULT 'UZS' CHECK (reporting_currency ~ '^[A-Z]{3}$'),
  active_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tashkent',
  hide_balances BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Application Sessions (stores only SHA-256 hash of opaque token)
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  active_workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  telegram_auth_date TIMESTAMPTZ NOT NULL,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_active ON public.sessions (user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_token_hash ON public.sessions (token_hash);
CREATE INDEX idx_sessions_expires_at ON public.sessions (expires_at);
