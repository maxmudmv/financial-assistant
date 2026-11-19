-- ==============================================================================
-- FINORA Migration 0007: Atomic Telegram User & Personal Workspace Bootstrap RPC
-- Runs inside a single PostgreSQL transaction on server-side login.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.bootstrap_telegram_user(
  p_telegram_id BIGINT,
  p_username TEXT,
  p_first_name TEXT,
  p_last_name TEXT,
  p_language_code public.language_code,
  p_photo_url TEXT
)
RETURNS TABLE (
  user_id UUID,
  is_new_user BOOLEAN,
  active_workspace_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_is_new BOOLEAN := false;
  v_workspace_id UUID;
  v_workspace_name TEXT;
  v_cash_name TEXT;
BEGIN
  -- 1. Find or create user atomically
  SELECT u.id INTO v_user_id
  FROM public.users u
  WHERE u.telegram_id = p_telegram_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    v_is_new := true;
    INSERT INTO public.users (
      telegram_id,
      username,
      first_name,
      last_name,
      language_code,
      photo_url,
      last_login_at
    )
    VALUES (
      p_telegram_id,
      NULLIF(trim(p_username), ''),
      COALESCE(NULLIF(trim(p_first_name), ''), 'FINORA User'),
      NULLIF(trim(p_last_name), ''),
      COALESCE(p_language_code, 'uz'::public.language_code),
      NULLIF(trim(p_photo_url), ''),
      now()
    )
    RETURNING id INTO v_user_id;
  ELSE
    UPDATE public.users
    SET
      username = NULLIF(trim(p_username), ''),
      first_name = COALESCE(NULLIF(trim(p_first_name), ''), first_name),
      last_name = NULLIF(trim(p_last_name), ''),
      photo_url = COALESCE(NULLIF(trim(p_photo_url), ''), photo_url),
      last_login_at = now(),
      is_active = true
    WHERE id = v_user_id;
  END IF;

  -- 2. Ensure personal workspace exists
  SELECT w.id INTO v_workspace_id
  FROM public.workspaces w
  WHERE w.owner_user_id = v_user_id
    AND w.type = 'personal'
    AND w.is_archived = false
  LIMIT 1;

  IF v_workspace_id IS NULL THEN
    v_workspace_name := CASE COALESCE(p_language_code, 'uz'::public.language_code)
      WHEN 'ru' THEN 'Личные финансы'
      WHEN 'en' THEN 'Personal Finance'
      ELSE 'Shaxsiy moliya'
    END;

    v_cash_name := CASE COALESCE(p_language_code, 'uz'::public.language_code)
      WHEN 'ru' THEN 'Наличные'
      WHEN 'en' THEN 'Cash Wallet'
      ELSE 'Naqd pul'
    END;

    INSERT INTO public.workspaces (name, type, owner_user_id, default_currency)
    VALUES (v_workspace_name, 'personal', v_user_id, 'UZS')
    RETURNING id INTO v_workspace_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (v_workspace_id, v_user_id, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;

    -- Starter Cash account
    INSERT INTO public.accounts (
      workspace_id, owner_user_id, name, type, currency,
      opening_balance, current_balance, visibility, icon, color
    )
    VALUES (
      v_workspace_id, v_user_id, v_cash_name, 'cash', 'UZS',
      0, 0, 'workspace', 'wallet', '#10B981'
    );

    -- Starter Multilingual Categories
    INSERT INTO public.categories (
      workspace_id, name, name_uz, name_ru, name_en, type, icon, color, is_system, sort_order
    )
    VALUES
      (v_workspace_id, 'Maosh', 'Maosh', 'Зарплата', 'Salary', 'income', 'briefcase', '#10B981', true, 1),
      (v_workspace_id, 'Biznes', 'Biznes', 'Бизнес', 'Business', 'income', 'trending-up', '#3B82F6', true, 2),
      (v_workspace_id, 'Sovg''a', 'Sovg''a', 'Подарок', 'Gift', 'income', 'gift', '#8B5CF6', true, 3),
      (v_workspace_id, 'Oziq-ovqat', 'Oziq-ovqat', 'Продукты', 'Groceries', 'expense', 'shopping-cart', '#F59E0B', true, 10),
      (v_workspace_id, 'Transport', 'Transport', 'Транспорт', 'Transport', 'expense', 'car', '#06B6D4', true, 11),
      (v_workspace_id, 'Uy-joy va kommunal', 'Uy-joy va kommunal', 'Жильё и ЖКХ', 'Housing & Utilities', 'expense', 'home', '#6366F1', true, 12),
      (v_workspace_id, 'Sog''liq', 'Sog''liq', 'Здоровье', 'Healthcare', 'expense', 'heart-pulse', '#EF4444', true, 13),
      (v_workspace_id, 'Ta''lim', 'Ta''lim', 'Образование', 'Education', 'expense', 'graduation-cap', '#8B5CF6', true, 14),
      (v_workspace_id, 'Kafe va restoran', 'Kafe va restoran', 'Кафе и рестораны', 'Dining Out', 'expense', 'utensils', '#EC4899', true, 15),
      (v_workspace_id, 'Boshqa', 'Boshqa', 'Другое', 'Other', 'both', 'circle-dot', '#64748B', true, 99);
  END IF;

  -- 3. Ensure user_settings and notification_preferences exist
  INSERT INTO public.user_settings (
    user_id, language, theme, reporting_currency, active_workspace_id
  )
  VALUES (
    v_user_id,
    COALESCE(p_language_code, 'uz'::public.language_code),
    'system',
    'UZS',
    v_workspace_id
  )
  ON CONFLICT (user_id) DO UPDATE
    SET active_workspace_id = COALESCE(public.user_settings.active_workspace_id, v_workspace_id)
  RETURNING public.user_settings.active_workspace_id INTO v_workspace_id;

  INSERT INTO public.notification_preferences (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN QUERY SELECT v_user_id, v_is_new, v_workspace_id;
END;
$$;
