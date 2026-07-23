import { runtimeConfig } from '../config/runtime';
import type {
  DeviceAuthContext,
  SyncCheckRequest,
  SyncCheckResponseData,
  SyncDownloadCompleteRequest,
  SyncDownloadProgressRequest,
  SyncStatusRequest,
} from '../shared/types/api';
import { apiFetchData } from './api';
import { toBackendDisplayTarget } from '../shared/displayTarget';
import type { DisplayTarget, HardwareProfile } from '../shared/types';

export interface SyncCheckOptions {
  cachedMediaVersionIds?: string[];
  displayTarget?: DisplayTarget;
  clusterMember?: SyncCheckRequest['clusterMember'];
  hardwareProfile?: HardwareProfile;
}

function buildSyncHeaders(auth: DeviceAuthContext, options: SyncCheckOptions) {
  const displayTarget = resolveSyncDisplayTarget(auth, options);
  const clusterMember = options.clusterMember ?? auth.clusterMember;

  const headers: Record<string, string> = {};
  if (displayTarget) headers['X-Display-Target'] = displayTarget;
  if (clusterMember) headers['X-Cluster-Member'] = clusterMember;

  return headers;
}

/** Always map SCREEN_* → HDMI* so backend binding filters match. */
function resolveSyncDisplayTarget(
  auth: DeviceAuthContext,
  options: SyncCheckOptions,
): string | undefined {
  const raw = options.displayTarget ?? auth.displayTarget;
  if (!raw) return undefined;
  if (/^HDMI\d+$/i.test(raw)) return raw.toUpperCase();
  return toBackendDisplayTarget(raw as DisplayTarget);
}

export async function checkSync(
  auth: DeviceAuthContext,
  options: SyncCheckOptions = {},
): Promise<SyncCheckResponseData> {
  const clusterMember = options.clusterMember ?? auth.clusterMember;
  const displayTarget = resolveSyncDisplayTarget(auth, options);

  const body: SyncCheckRequest = {
    runtimeVersion: runtimeConfig.runtimeVersion,
    cachedMediaVersionIds: options.cachedMediaVersionIds ?? [],
  };

  if (displayTarget) {
    body.displayTarget = displayTarget;
  }
  if (clusterMember) {
    body.clusterMember = clusterMember;
  }

  const extraHeaders = buildSyncHeaders(auth, {
    ...options,
    clusterMember,
  });

  return apiFetchData<SyncCheckResponseData>('/sync/check', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    headers: extraHeaders,
    body: JSON.stringify(body),
  });
}

export async function reportDownloadComplete(
  auth: DeviceAuthContext,
  payload: SyncDownloadCompleteRequest,
): Promise<void> {
  await apiFetchData<unknown>('/sync/download-complete', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify(payload),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Durable download-complete: retries so admin Required Media does not stick on
 * MISSING/FAILED after a successful local download.
 */
export async function reportDownloadCompleteWithRetry(
  auth: DeviceAuthContext,
  payload: SyncDownloadCompleteRequest,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<void> {
  const attempts = options?.attempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await reportDownloadComplete(auth, payload);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(baseDelayMs * attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('download-complete failed after retries');
}

export async function reportDownloadProgress(
  auth: DeviceAuthContext,
  payload: SyncDownloadProgressRequest,
): Promise<void> {
  await apiFetchData<unknown>('/sync/download-progress', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify(payload),
  });
}

export async function reportSyncStatus(
  auth: DeviceAuthContext,
  payload: SyncStatusRequest,
): Promise<void> {
  await apiFetchData<unknown>('/sync/status', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify(payload),
  });
}
