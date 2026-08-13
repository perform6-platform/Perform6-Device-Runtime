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

  const url = `${runtimeConfig.apiBaseUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const lower = raw.toLowerCase();
    const tlsHint =
      lower.includes('cert') ||
      lower.includes('ssl') ||
      lower.includes('tls') ||
      lower.includes('nss') ||
      lower.includes('certificate');
    throw new ApiError(
      0,
      path,
      tlsHint
        ? `HTTPS/TLS failed talking to API (${raw}). Player certificate store may be outdated (NSS). Update BrightSignOS or check VITE_API_BASE_URL.`
        : raw === 'Failed to fetch' || e instanceof TypeError
          ? `Network request failed for ${path}. Check Ethernet/Wi-Fi and that the player can reach ${runtimeConfig.apiBaseUrl}`
          : `Network request failed for ${path}: ${raw}`,
    );
  }

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
