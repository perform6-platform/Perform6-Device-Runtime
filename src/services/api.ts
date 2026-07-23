import { runtimeConfig } from '../config/runtime';

export class ApiError extends Error {
  constructor(
    public status: number,
    path: string,
    message?: string,
  ) {
    super(message ?? `API ${status}: ${path}`);
    this.name = 'ApiError';
  }
}

export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data: T;
  timestamp?: string;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string; deviceId?: string } = {},
): Promise<T> {
  const { token, deviceId, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (deviceId) headers.set('X-Device-Id', deviceId);

  const res = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, path, body || undefined);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Unwraps Perform6 API `{ success, data }` envelope. */
export async function apiFetchData<T>(
  path: string,
  options: RequestInit & { token?: string; deviceId?: string } = {},
): Promise<T> {
  const envelope = await apiFetch<ApiEnvelope<T>>(path, options);
  return envelope.data;
}
