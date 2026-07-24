import type { DeviceAuthContext } from '../shared/types/api';
import { apiFetchData } from './api';
import {
  getPlaybackTelemetrySnapshot,
  type ScreenPlaybackSample,
} from './playbackTelemetry';

export async function sendPlaybackTelemetry(
  auth: DeviceAuthContext,
  screens: ScreenPlaybackSample[] = getPlaybackTelemetrySnapshot(),
): Promise<{ success: boolean }> {
  if (screens.length === 0) {
    return { success: true };
  }

  return apiFetchData<{ success: boolean }>('/devices/me/playback-telemetry', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify({
      playbackState: screens.some((s) => s.isPlaying) ? 'PLAYING' : 'PAUSED',
      sampledAt: new Date().toISOString(),
      screens: screens.map((s) => ({
        screenKey: s.screenKey,
        mediaVersionId: s.mediaVersionId ?? null,
        title: s.title ?? null,
        positionMs: s.positionMs,
        durationMs: s.durationMs ?? null,
        isPlaying: s.isPlaying,
      })),
    }),
  });
}
