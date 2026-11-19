export interface ApiErrorShape {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Kept strictly in JS memory as fallback for Telegram WebViews that restrict third-party cookies.
// Never persisted to localStorage or sessionStorage.
let inMemorySessionToken: string | null = null;

export function setInMemorySessionToken(token: string | null): void {
  inMemorySessionToken = token;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    idempotencyKey?: string;
    workspaceId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (inMemorySessionToken) {
    headers.Authorization = `Bearer ${inMemorySessionToken}`;
  }
  if (options.idempotencyKey) {
    headers['X-Idempotency-Key'] = options.idempotencyKey;
  }
  if (options.workspaceId) {
    headers['X-Workspace-Id'] = options.workspaceId;
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  let payload: unknown = null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    payload = await response.json();
  }

  if (!response.ok) {
    const errObj =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: ApiErrorShape }).error
        : null;
    throw new ApiClientError(
      response.status,
      errObj?.code ?? 'API_ERROR',
      errObj?.message ?? `Request failed (${response.status})`,
      errObj?.details,
    );
  }

  return payload as T;
}

/**
 * Performs an authenticated binary file download (PDF/XLSX/CSV) using both HttpOnly cookies
 * and the in-memory Bearer fallback + active workspace header for Telegram WebViews.
 */
export async function downloadApiFile(
  path: string,
  options: { workspaceId?: string; fallbackFileName: string },
): Promise<void> {
  const headers: Record<string, string> = {};
  if (inMemorySessionToken) {
    headers.Authorization = `Bearer ${inMemorySessionToken}`;
  }
  if (options.workspaceId) {
    headers['X-Workspace-Id'] = options.workspaceId;
  }

  const response = await fetch(path, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    throw new ApiClientError(response.status, 'EXPORT_FAILED', `Export failed (${response.status})`);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/i);
  const fileName = match?.[1] || options.fallbackFileName;

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
