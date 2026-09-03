import type { DeviceAuthContext } from '../shared/types/api';
import { apiFetchData } from './api';
import type { SdFsAction, SdFsEntry } from './sdFsBridge';

export interface DeviceSdFsResultPayload {
  commandId: string;
  action: SdFsAction | string;
  ok: boolean;
  path: string;
  entries?: SdFsEntry[];
  content?: string;
  encoding?: string;
  error?: string;
  sizeBytes?: number;
}

/** Push remote SD FS result for Admin mini-DWS poll. */
export async function reportSdFsResult(
  auth: DeviceAuthContext,
  payload: DeviceSdFsResultPayload,
): Promise<void> {
  await apiFetchData<unknown>('/devices/me/sd-fs-result', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify(payload),
    timeoutMs: 20_000,
  });
}

export function reportSdFsResultSafe(
  auth: DeviceAuthContext,
  payload: DeviceSdFsResultPayload,
): void {
  void reportSdFsResult(auth, payload).catch((error) => {
    console.warn('[Perform6] sd-fs-result report failed', error);
  });
}
