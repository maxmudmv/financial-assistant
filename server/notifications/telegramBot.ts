import type { SupabaseClient } from '@supabase/supabase-js';

export interface SendTelegramMessageOptions {
  botToken?: string;
  chatId: number;
  text: string;
  fetchImpl?: typeof fetch;
}

/**
 * Sends a notification message via the official Telegram Bot API (`sendMessage`).
 * Never throws on network errors; returns structured delivery status for `notifications` table.
 */
export async function sendTelegramBotMessage(
  options: SendTelegramMessageOptions,
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const token = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.length < 10) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  }

  const fetchFn = options.fetchImpl ?? fetch;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: options.chatId,
        text: options.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const data = (await response.json()) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
    };

    if (!response.ok || !data.ok) {
      return { ok: false, error: data.description ?? `HTTP ${response.status}` };
    }

    return { ok: true, messageId: data.result?.message_id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Telegram request failed',
    };
  }
}

/**
 * Persists an in-app notification with deduplication (`dedupe_key`) and optionally
 * delivers it via Telegram Bot API if the user's preferences allow it.
 */
export async function dispatchWorkspaceNotification(options: {
  supabase: SupabaseClient;
  workspaceId: string;
  userId: string;
  telegramId?: number;
  type: string;
  title: string;
  body: string;
  dedupeKey: string;
  payload?: Record<string, unknown>;
}): Promise<{ created: boolean; telegramSent: boolean }> {
  const { data: existing } = await options.supabase
    .from('notifications')
    .select('id')
    .eq('user_id', options.userId)
    .eq('dedupe_key', options.dedupeKey)
    .maybeSingle();

  if (existing) {
    return { created: false, telegramSent: false };
  }

  const { data: prefs } = await options.supabase
    .from('notification_preferences')
    .select('telegram_enabled')
    .eq('user_id', options.userId)
    .maybeSingle();

  const wantsTelegram = prefs?.telegram_enabled !== false && Boolean(options.telegramId);
  let deliveryStatus: 'pending' | 'sent' | 'failed' = 'pending';
  let telegramMessageId: number | null = null;
  let errorMessage: string | null = null;

  if (wantsTelegram && options.telegramId) {
    const sent = await sendTelegramBotMessage({
      chatId: options.telegramId,
      text: `<b>${escapeHtml(options.title)}</b>\n${escapeHtml(options.body)}`,
    });
    if (sent.ok) {
      deliveryStatus = 'sent';
      telegramMessageId = sent.messageId ?? null;
    } else {
      deliveryStatus = 'failed';
      errorMessage = sent.error ?? null;
    }
  }

  await options.supabase.from('notifications').insert({
    workspace_id: options.workspaceId,
    user_id: options.userId,
    type: options.type,
    title: options.title,
    body: options.body,
    payload: options.payload ?? {},
    dedupe_key: options.dedupeKey,
    channel: wantsTelegram ? 'both' : 'in_app',
    delivery_status: deliveryStatus,
    telegram_message_id: telegramMessageId,
    delivered_at: deliveryStatus === 'sent' ? new Date().toISOString() : null,
    error_message: errorMessage,
  });

  return { created: true, telegramSent: deliveryStatus === 'sent' };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
