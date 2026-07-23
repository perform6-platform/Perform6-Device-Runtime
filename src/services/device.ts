import type { DeviceAuthContext } from '../shared/types/api';
import { apiFetchData } from './api';

export interface UpdateDeviceMetadataRequest {
  deviceName?: string;
  firmwareVersion?: string;
  runtimeVersion?: string;
}

export async function updateDeviceMetadata(
  auth: DeviceAuthContext,
  payload: UpdateDeviceMetadataRequest,
): Promise<void> {
  await apiFetchData<unknown>('/devices/me/metadata', {
    method: 'PATCH',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify(payload),
  });
}
