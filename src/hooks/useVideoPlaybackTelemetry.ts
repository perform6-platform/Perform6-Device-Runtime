import { useEffect, type RefObject } from 'react';
import {
  clearScreenPlayback,
  reportScreenPlayback,
} from '../services/playbackTelemetry';

const REPORT_INTERVAL_MS = 2_000;

export interface VideoTelemetryIdentity {
  screenKey: string;
  mediaVersionId?: string | null;
  title?: string | null;
}

/**
 * Periodically samples a <video> element into the local telemetry registry.
 * Cheap local writes only — network flush is handled by RuntimeContext.
 */
export function useVideoPlaybackTelemetry(
  videoRef: RefObject<HTMLVideoElement | null>,
  identity: VideoTelemetryIdentity | null | undefined,
  enabled = true,
): void {
  const screenKey = identity?.screenKey;
  const mediaVersionId = identity?.mediaVersionId ?? null;
  const title = identity?.title ?? null;

  useEffect(() => {
    if (!enabled || !screenKey) return;

    const tick = () => {
      const video = videoRef.current;
      if (!video || !video.src) {
        clearScreenPlayback(screenKey);
        return;
      }

      const durationMs =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration * 1000
          : null;

      reportScreenPlayback({
        screenKey,
        mediaVersionId,
        title,
        positionMs: (video.currentTime || 0) * 1000,
        durationMs,
        isPlaying: !video.paused && !video.ended,
      });
    };

    tick();
    const id = window.setInterval(tick, REPORT_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      clearScreenPlayback(screenKey);
    };
  }, [enabled, mediaVersionId, screenKey, title, videoRef]);
}
