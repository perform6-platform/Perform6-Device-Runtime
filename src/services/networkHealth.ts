import { runtimeConfig } from '../config/runtime';

export type NetworkHealth = 'checking' | 'online' | 'offline';

export interface NetworkProbeResult {
  health: Exclude<NetworkHealth, 'checking'>;
  detail: string;
  checkedAt: string;
}

/**
 * Probe Perform6 API reachability.
 * Any HTTP response (including 4xx/5xx) means the device has network path to the server.
 * TypeError / abort ⇒ offline or unreachable.
 */
export async function probeApiReachability(timeoutMs = 8000): Promise<NetworkProbeResult> {
  const checkedAt = new Date().toISOString();

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      health: 'offline',
      detail: 'Device reports no network link (navigator.onLine = false)',
      checkedAt,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(runtimeConfig.apiBaseUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return {
      health: 'online',
      detail: 'Reachable: Perform6 API responded',
      checkedAt,
    };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const message = e instanceof Error ? e.message : String(e);

    if (name === 'AbortError') {
      return {
        health: 'offline',
        detail: 'Network timeout — could not reach Perform6 server',
        checkedAt,
      };
    }

    const lower = message.toLowerCase();
    const tlsHint =
      lower.includes('cert') ||
      lower.includes('ssl') ||
      lower.includes('tls') ||
      lower.includes('nss') ||
      lower.includes('certificate');

    return {
      health: 'offline',
      detail: tlsHint
        ? `HTTPS/TLS to API failed (${message}). BrightSign certificate store may need a firmware update.`
        : message && message !== 'Failed to fetch'
          ? message
          : 'Internet / network not connected to this device (or HTTPS to API failed)',
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}
