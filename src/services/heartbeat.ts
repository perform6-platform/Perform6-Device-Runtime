import { runtimeConfig } from '../config/runtime';
import type { DeviceAuthContext, DeviceHeartbeatRequest } from '../shared/types/api';
import { apiFetchData } from './api';
import { flushDeviceLogs } from './deviceLogsApi';
import { peekDeviceLogCount } from './deviceLogCollector';
import type { DeviceRemoteCommand } from './remoteCommandBridge';
import { getTouchUiState } from './touchUiTelemetry';

export interface DeviceHeartbeatResult {
  success: boolean;
  remoteCommands?: DeviceRemoteCommand[];
}

export async function sendDeviceHeartbeat(
  auth: DeviceAuthContext,
  payload: DeviceHeartbeatRequest = {},
): Promise<DeviceHeartbeatResult> {
  const touchUi = getTouchUiState();
  const body: DeviceHeartbeatRequest = {
    runtimeVersion: runtimeConfig.runtimeVersion,
    playbackState: touchUi.playbackState,
    currentContent: touchUi.currentContent
      ? {
          slot: touchUi.currentContent.slot,
          title: touchUi.currentContent.title ?? undefined,
          mediaVersionId: touchUi.currentContent.mediaVersionId ?? undefined,
          screenKey: touchUi.currentContent.screenKey,
          sessionStartedAt: touchUi.currentContent.sessionStartedAt ?? undefined,
        }
      : undefined,
    ...payload,
  };

  const result = await apiFetchData<DeviceHeartbeatResult>('/devices/me/heartbeat', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify(body),
  });

  if (peekDeviceLogCount() > 20) {
    void flushDeviceLogs(auth).catch(() => {
      /* best-effort */
    });
  }

  return result;
}
