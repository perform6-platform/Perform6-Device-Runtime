import type { DeviceAuthContext } from '../shared/types/api';
import { apiFetchData } from './api';

export type DeviceOtaReportStatus =
  | 'DOWNLOADING'
  | 'REBOOTING'
  | 'FAILED'
  | 'COMPLETE';

export interface DeviceOtaStatusPayload {
  status: DeviceOtaReportStatus;
  targetVersion?: string;
  doneCount?: number;
  totalCount?: number;
  currentPath?: string;
  bytesDownloaded?: number;
  bytesTotal?: number;
  error?: string;
  runtimeVersion?: string;
}

/** Best-effort OTA progress for admin fleet view. */
export async function reportOtaStatus(
  auth: DeviceAuthContext,
  payload: DeviceOtaStatusPayload,
): Promise<void> {
  await apiFetchData<unknown>('/devices/me/ota-status', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify(payload),
    timeoutMs: 15_000,
  });
}

export function reportOtaStatusSafe(
  auth: DeviceAuthContext,
  payload: DeviceOtaStatusPayload,
): void {
  void reportOtaStatus(auth, payload).catch(() => {
    /* monitoring only */
  });
}

/**
 * Must succeed before reboot: API marks completedPaths on REBOOTING/COMPLETE.
 * Fire-and-forget + immediate reboot re-offers the same wave forever.
 */
export async function reportOtaStatusWithRetry(
  auth: DeviceAuthContext,
  payload: DeviceOtaStatusPayload,
  options?: { attempts?: number; label?: string },
): Promise<boolean> {
  const attempts = Math.max(1, options?.attempts ?? 5);
  const label = options?.label ?? payload.status;
  for (let i = 0; i < attempts; i++) {
    try {
      await reportOtaStatus(auth, payload);
      if (i > 0) {
        console.info(
          `[Perform6] OTA status ${label} ok on attempt ${i + 1}/${attempts}`,
        );
      }
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Perform6] OTA status ${label} attempt ${i + 1}/${attempts} failed: ${msg}`,
      );
      if (i < attempts - 1) {
        await new Promise((r) => window.setTimeout(r, 750 * (i + 1)));
      }
    }
  }
  return false;
}
