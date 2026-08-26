import { DisplayVideoPlayer } from '../../display-ui';
import { findScreenForTarget, getCurrentVideo } from '../../services/playback';
import { useOfflineVideoSrc } from '../../hooks/useOfflineVideoSrc';
import { XC4055_SCREEN_FALLBACK_LABELS } from '../../shared/displayTarget';
import type { DisplayTarget } from '../../shared/types';
import { useRuntime, useSync } from '../../hooks/useRuntime';
import { runtimeConfig, xcRoleToDisplayTarget } from '../../config/runtime';

const OUTPUT_TARGETS: DisplayTarget[] = ['SCREEN_1', 'SCREEN_2', 'SCREEN_3'];

/**
 * One physical LED output — full 1920×1080 content for one logical screen.
 */
function XcOutputSurface({
  target,
  manifest,
  runtimePhase,
}: {
  target: DisplayTarget;
  manifest: ReturnType<typeof useRuntime>['store']['playbackState']['manifest'];
  runtimePhase: string;
}) {
  const screen = manifest ? findScreenForTarget(manifest, target) : undefined;
  const video = getCurrentVideo(screen);
  const offlineSrc = useOfflineVideoSrc(video?.id, video?.url);
  const videoSrc = offlineSrc ?? (video?.url ? video.url : null);
  const label =
    screen?.label?.trim() || XC4055_SCREEN_FALLBACK_LABELS[target] || target;

  return (
    <section className="relative h-full w-full overflow-hidden bg-black">
      {videoSrc ? (
        <DisplayVideoPlayer
          src={videoSrc}
          label={label}
          loop
          screenKey={target}
          mediaVersionId={video?.id ?? null}
          mediaTitle={video?.title ?? null}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-sm font-semibold text-slate-200">{label}</p>
          <p className="max-w-sm text-xs text-slate-500">
            {manifest
              ? `Waiting for media · ${runtimePhase}`
              : `Syncing… · ${runtimePhase}`}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Production XC4055 — BrightSign uses three independent 1920×1080 HtmlWidgets.
 * HDMI-1 (this page) only renders SCREEN_1. HDMI-2/3 are separate widgets.
 * Simulator keeps the 3-column preview for convenience.
 */
export default function XC4055Display() {
  const { store } = useRuntime();
  const { syncState } = useSync();
  const manifest = store.playbackState.manifest;

  if (!runtimeConfig.isSimulator) {
    return (
      <main className="h-full w-full overflow-hidden bg-black">
        <XcOutputSurface
          target={xcRoleToDisplayTarget('primary')}
          manifest={manifest}
          runtimePhase={syncState.runtimePhase}
        />
      </main>
    );
  }

  return (
    <main className="flex h-full w-full flex-row overflow-hidden bg-black">
      {OUTPUT_TARGETS.map((target) => (
        <div key={target} className="relative h-full min-w-0 flex-1 overflow-hidden">
          <XcOutputSurface
            target={target}
            manifest={manifest}
            runtimePhase={syncState.runtimePhase}
          />
        </div>
      ))}
    </main>
  );
}
