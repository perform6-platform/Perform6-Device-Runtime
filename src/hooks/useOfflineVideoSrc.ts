import { useEffect, useState } from 'react';
import {
  findTouchScreen,
  getCurrentVideo,
  type TouchPlaybackSlot,
} from '../services/playback';
import type { PlaybackManifest } from '../shared/types';
import { resolveLocalPlaybackUrl } from '../services/media';

/** Resolve SD-sim (IndexedDB) playback URL for a mediaVersionId — null if not cached. */
export function useOfflineVideoSrc(mediaVersionId: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!mediaVersionId) {
      setSrc(null);
      return;
    }

    void resolveLocalPlaybackUrl(mediaVersionId).then((url) => {
      if (!cancelled) setSrc(url);
    });

    return () => {
      cancelled = true;
    };
  }, [mediaVersionId]);

  return src;
}

function useSlotOfflineSrc(
  manifest: PlaybackManifest | null | undefined,
  slotId: TouchPlaybackSlot,
): string | null {
  const screen = manifest ? findTouchScreen(manifest, slotId) : undefined;
  const video = getCurrentVideo(screen);
  const offlineSrc = useOfflineVideoSrc(video?.id);
  // Prefer IndexedDB; fall back to sync fileUrl from DB (never local mock mp4).
  return offlineSrc ?? (video?.url ? video.url : null);
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
