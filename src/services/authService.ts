import { apiRequest, setInMemorySessionToken } from '@/lib/apiClient';
import type {
  AuthSessionResponse,
  AuthorizedWorkspace,
  HealthResponse,
} from '@/types/auth';

export async function authenticateWithTelegram(initData: string): Promise<AuthSessionResponse> {
  const response = await apiRequest<AuthSessionResponse>('/api/auth/telegram', {
    method: 'POST',
    body: { initData },
  });

  if (response.sessionToken) {
    setInMemorySessionToken(response.sessionToken);
  }

  return response;
}

export async function fetchActiveSession(): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>('/api/auth/session', {
    method: 'GET',
  });
}

export async function switchActiveWorkspace(workspaceId: string): Promise<{
  activeWorkspace: AuthorizedWorkspace;
  workspaces: AuthorizedWorkspace[];
}> {
  return apiRequest('/api/auth/switch-workspace', {
    method: 'POST',
    body: { workspaceId },
  });
}

export async function logoutSession(): Promise<void> {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } finally {
    setInMemorySessionToken(null);
  }
}

export async function fetchApiHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/api/health', { method: 'GET' });
}
