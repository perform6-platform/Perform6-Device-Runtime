import type { DeviceAuthContext } from '../shared/types/api';
import { apiFetchData } from './api';
import {
  getPlaybackTelemetrySnapshot,
  type ScreenPlaybackSample,
} from './playbackTelemetry';
import { getTouchUiState } from './touchUiTelemetry';

export async function sendPlaybackTelemetry(
  auth: DeviceAuthContext,
  screens: ScreenPlaybackSample[] = getPlaybackTelemetrySnapshot(),
): Promise<{ success: boolean }> {
  if (screens.length === 0 && !getTouchUiState().currentContent) {
    return { success: true };
  }

  const touchUi = getTouchUiState();

  return apiFetchData<{ success: boolean }>('/devices/me/playback-telemetry', {
    method: 'POST',
    token: auth.apiToken,
    deviceId: auth.deviceId,
    body: JSON.stringify({
      playbackState: touchUi.playbackState,
      currentContent: touchUi.currentContent
        ? {
            slot: touchUi.currentContent.slot,
            title: touchUi.currentContent.title,
            mediaVersionId: touchUi.currentContent.mediaVersionId,
            screenKey: touchUi.currentContent.screenKey,
            sessionStartedAt: touchUi.currentContent.sessionStartedAt,
          }
        : undefined,
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
