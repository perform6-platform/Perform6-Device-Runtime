import { runtimeConfig } from '../config/runtime';
import type { DeviceAuthContext, DeviceHeartbeatRequest } from '../shared/types/api';
import { apiFetchData } from './api';

export async function sendDeviceHeartbeat(
  auth: DeviceAuthContext,
  payload: DeviceHeartbeatRequest = {},
): Promise<{ success: boolean }> {
  const body: DeviceHeartbeatRequest = {
    runtimeVersion: runtimeConfig.runtimeVersion,
    playbackState: 'PLAYING',
    ...payload,
  };

  return apiFetchData<{ success: boolean }>('/devices/me/heartbeat', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify(body),
  });
}
