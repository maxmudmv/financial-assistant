-- ==============================================================================
-- FINORA Migration 0005: Notifications, Notification Preferences, Audit Logs,
-- Idempotency Keys, and Serverless PostgreSQL Rate Limiting
-- ==============================================================================

-- Notifications (in-app & Telegram Bot API delivery tracking with deduplication)
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT,
  channel public.notification_channel NOT NULL DEFAULT 'both',
  delivery_status public.notification_delivery_status NOT NULL DEFAULT 'pending',
  telegram_message_id BIGINT,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_pending ON public.notifications (delivery_status, created_at)
  WHERE delivery_status = 'pending';
CREATE UNIQUE INDEX idx_notifications_dedupe
  ON public.notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-User Notification Preferences
CREATE TABLE public.notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  telegram_enabled BOOLEAN NOT NULL DEFAULT true,
  budget_warnings BOOLEAN NOT NULL DEFAULT true,
  upcoming_payments BOOLEAN NOT NULL DEFAULT true,
  debt_reminders BOOLEAN NOT NULL DEFAULT true,
  goal_milestones BOOLEAN NOT NULL DEFAULT true,
  weekly_summary BOOLEAN NOT NULL DEFAULT true,
  monthly_summary BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Append-Only Security & Financial Audit Logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_workspace_created ON public.audit_logs (workspace_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor_created ON public.audit_logs (actor_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON public.audit_logs (action, created_at DESC);

CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_record_mutation();

-- API Idempotency Keys (prevents duplicate financial mutations on retries)
CREATE TABLE public.idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INT,
  response_body JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key, request_path)
);

CREATE INDEX idx_idempotency_keys_expires ON public.idempotency_keys (expires_at);

-- Serverless PostgreSQL Rate Limiting (zero-cost alternative to Redis)
CREATE TABLE public.rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  hits INT NOT NULL DEFAULT 1,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_rate_limit_buckets_expires ON public.rate_limit_buckets (expires_at);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket_key TEXT,
  p_limit INT,
  p_window_seconds INT
)
RETURNS TABLE (
  allowed BOOLEAN,
  current_hits INT,
  reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_expires TIMESTAMPTZ := v_now + make_interval(secs => p_window_seconds);
  v_hits INT;
  v_reset TIMESTAMPTZ;
BEGIN
  -- Prune expired bucket if present and atomically upsert active window
  INSERT INTO public.rate_limit_buckets (bucket_key, hits, window_started_at, expires_at)
  VALUES (p_bucket_key, 1, v_now, v_expires)
  ON CONFLICT (bucket_key) DO UPDATE
    SET
      hits = CASE
        WHEN public.rate_limit_buckets.expires_at <= v_now THEN 1
        ELSE public.rate_limit_buckets.hits + 1
      END,
      window_started_at = CASE
        WHEN public.rate_limit_buckets.expires_at <= v_now THEN v_now
        ELSE public.rate_limit_buckets.window_started_at
      END,
      expires_at = CASE
        WHEN public.rate_limit_buckets.expires_at <= v_now THEN v_expires
        ELSE public.rate_limit_buckets.expires_at
      END
  RETURNING public.rate_limit_buckets.hits, public.rate_limit_buckets.expires_at
  INTO v_hits, v_reset;

  RETURN QUERY SELECT (v_hits <= p_limit), v_hits, v_reset;
END;
$$;
