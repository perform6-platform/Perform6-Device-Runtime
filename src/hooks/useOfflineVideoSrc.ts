import { useEffect, useState } from 'react';
import {
  findTouchScreen,
  getCurrentVideo,
  type TouchPlaybackSlot,
} from '../services/playback';
import type { PlaybackManifest } from '../shared/types';
import { resolveLocalPlaybackUrl } from '../services/media';
import { resolvePlaybackSrc } from '../services/playbackSrc';
import { subscribeSdCacheProgress } from '../services/sdCacheBridge';

/** Resolve playback URL — SD cache on device, HTTPS only in the simulator. */
export function useOfflineVideoSrc(
  mediaVersionId: string | null | undefined,
  fallbackFileUrl?: string | null,
): string | null {
  const [localSrc, setLocalSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!mediaVersionId) {
      setLocalSrc(null);
      return;
    }

    const resolve = () => {
      void resolveLocalPlaybackUrl(mediaVersionId, fallbackFileUrl).then((url) => {
        if (!cancelled) setLocalSrc(url);
      });
    };

    resolve();

    const unsubscribe = subscribeSdCacheProgress((event) => {
      if (event.mediaVersionId !== mediaVersionId) return;
      if (event.status === 'done' || event.status === 'skip') {
        resolve();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [mediaVersionId, fallbackFileUrl]);

  return resolvePlaybackSrc(localSrc, fallbackFileUrl);
}

function useSlotOfflineSrc(
  manifest: PlaybackManifest | null | undefined,
  slotId: TouchPlaybackSlot,
): string | null {
  const screen = manifest ? findTouchScreen(manifest, slotId) : undefined;
  const video = getCurrentVideo(screen);
  return useOfflineVideoSrc(video?.id, video?.url);
}

/**
 * Touch display URLs from synced DB categories only (no /videos/*.mp4 mock).
 * `idle` = DEFAULT category — ambient loop behind buttons + HDMI until a session starts.
 */
export function useTouchVideos(manifest: PlaybackManifest | null | undefined) {
  const idle = useSlotOfflineSrc(manifest, 'touch-default');
  const startHere = useSlotOfflineSrc(manifest, 'start-here');
  const phase1 = useSlotOfflineSrc(manifest, 'phase1');
  const phase2 = useSlotOfflineSrc(manifest, 'phase2');
  const fullProgram = useSlotOfflineSrc(manifest, 'full-program');

  return { idle, startHere, phase1, phase2, fullProgram };
}

/** Media identity for telemetry (id = mediaVersionId from sync manifest). */
export function getTouchSlotMedia(
  manifest: PlaybackManifest | null | undefined,
  slotId: TouchPlaybackSlot,
): { mediaVersionId: string | null; title: string | null; url: string | null } {
  const screen = manifest ? findTouchScreen(manifest, slotId) : undefined;
  const video = getCurrentVideo(screen);
  return {
    mediaVersionId: video?.id ?? null,
    title: video?.title ?? null,
    url: video?.url ?? null,
  };
}
