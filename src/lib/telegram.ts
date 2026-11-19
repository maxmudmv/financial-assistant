export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: TelegramWebAppUser;
    auth_date?: number;
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  isExpanded: boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

export function getTelegramInitData(): string {
  const webApp = getTelegramWebApp();
  return webApp?.initData?.trim() ?? '';
}

export function isInsideTelegramMiniApp(): boolean {
  return getTelegramInitData().length > 0;
}

export function initTelegramWebApp(): TelegramWebApp | null {
  const webApp = getTelegramWebApp();
  if (!webApp) return null;

  try {
    webApp.ready();
    webApp.expand();
  } catch {
    // Safe no-op outside Telegram container
  }

  return webApp;
}

export function syncTelegramChromeColors(resolvedTheme: 'dark' | 'light'): void {
  const webApp = getTelegramWebApp();
  if (!webApp) return;
  const color = resolvedTheme === 'dark' ? '#060B16' : '#DCE7F3';
  try {
    webApp.setHeaderColor?.(color);
    webApp.setBackgroundColor?.(color);
  } catch {
    // Older Telegram clients may not support chrome color setters
  }
}

export function triggerHaptic(
  type: 'light' | 'medium' | 'success' | 'error' | 'selection' = 'light',
): void {
  const haptic = getTelegramWebApp()?.HapticFeedback;
  if (!haptic) return;
  try {
    if (type === 'selection') {
      haptic.selectionChanged();
    } else if (type === 'success' || type === 'error') {
      haptic.notificationOccurred(type);
    } else {
      haptic.impactOccurred(type);
    }
  } catch {
    // Ignore haptic errors on desktop clients
  }
}
