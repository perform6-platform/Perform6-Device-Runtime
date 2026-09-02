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
