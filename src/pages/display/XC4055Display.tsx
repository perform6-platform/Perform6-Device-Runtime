import { DisplayVideoPlayer } from '../../display-ui';
import { findScreenForTarget, getCurrentVideo } from '../../services/playback';
import { useOfflineVideoSrc } from '../../hooks/useOfflineVideoSrc';
import { XC4055_SCREEN_FALLBACK_LABELS } from '../../shared/displayTarget';
import { runtimeConfig } from '../../config/runtime';
import { useRuntime, useSync } from '../../hooks/useRuntime';

/**
 * Production XC4055 surface — one fullscreen HTML output for the baked
 * VITE_DISPLAY_TARGET (SCREEN_1|2|3 → HDMI1|2|3 convention).
 */
export default function XC4055Display() {
  const { store } = useRuntime();
  const { syncState } = useSync();
  const manifest = store.playbackState.manifest;
  const target = runtimeConfig.displayTarget;

  const screen = manifest ? findScreenForTarget(manifest, target) : undefined;
  const video = getCurrentVideo(screen);
  const offlineSrc = useOfflineVideoSrc(video?.id);
  const videoSrc = offlineSrc ?? (video?.url ? video.url : null);
  const label =
    screen?.label?.trim() ||
    XC4055_SCREEN_FALLBACK_LABELS[target] ||
    target;

  return (
    <main className="flex h-full w-full flex-col bg-black">
      {videoSrc ? (
        <div className="min-h-0 flex-1">
          <DisplayVideoPlayer
            src={videoSrc}
            label={label}
            loop
            screenKey={target}
            mediaVersionId={video?.id ?? null}
            mediaTitle={video?.title ?? null}
          />
        </div>
      ) : (
        <section className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm font-semibold text-slate-200">{label}</p>
          <p className="max-w-md text-xs text-slate-500">
            {manifest
              ? `Waiting for media on ${target}. Phase: ${syncState.runtimePhase}`
              : `Syncing… Phase: ${syncState.runtimePhase}`}
          </p>
        </section>
      )}
    </main>
  );
}
