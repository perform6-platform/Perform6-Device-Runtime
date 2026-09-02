import { runtimeConfig } from '../config/runtime';
import { handleDeviceRevoked, isDeviceAuthFailure } from './deviceAuthRevoke';

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

export type ApiFetchOptions = RequestInit & {
  token?: string;
  deviceId?: string;
  timeoutMs?: number;
};

/** Prefer backend `message` / `error` fields so LCD can show a short readable string. */
export function formatApiFailureMessage(status: number, path: string, body: string): string {
  const prefix = `API ${status} ${path}`;
  const raw = body?.trim() ?? '';
  if (!raw) {
    return `${prefix}: empty response body (no backend message)`;
  }

  const clipped = raw.replace(/\s+/g, ' ').trim().slice(0, 240);

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidates = [parsed.message, parsed.error, parsed.detail, parsed.title];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) {
        return `${prefix}: ${c.trim()}`;
      }
      if (Array.isArray(c) && c.length > 0) {
        const joined = c.map(String).filter(Boolean).join('; ');
        if (joined) return `${prefix}: ${joined}`;
      }
    }
    return `${prefix}: JSON error body has no message/error field — ${clipped}`;
  } catch {
    return `${prefix}: non-JSON error body — ${clipped}`;
  }
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { token, deviceId, timeoutMs = 45_000, signal: outerSignal, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (deviceId) headers.set('X-Device-Id', deviceId);

  const url = `${runtimeConfig.apiBaseUrl}${path}`;
  const controller = new AbortController();
  const timer =
    timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : undefined;
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ApiError(res.status, path, formatApiFailureMessage(res.status, path, body));
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) {
      if (options.deviceId && isDeviceAuthFailure(e)) {
        handleDeviceRevoked(e.message);
      }
      throw e;
    }
    const raw = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : '';
    if (name === 'AbortError') {
      throw new ApiError(
        0,
        path,
        `Request timed out after ${timeoutMs}ms for ${path}. Check network path to ${runtimeConfig.apiBaseUrl}`,
      );
    }
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
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

/** Unwraps Perform6 API `{ success, data }` envelope. */
export async function apiFetchData<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const envelope = await apiFetch<ApiEnvelope<T>>(path, options);
  return envelope.data;
}
