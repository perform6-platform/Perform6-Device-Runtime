import Home from '../Home';
import { DisplayVideoPlayer } from '../../display-ui';
import { useDisplayPlayback, useRuntime } from '../../hooks/useRuntime';
import { useTouchVideos } from '../../hooks/useOfflineVideoSrc';
import { useRuntimeStore } from '../../stores/runtimeStore';

/**
 * Production XT2145 layout for BrightSign multi-HDMI canvas (3840×1080).
 * HDMI-1 (left): Bluefin touch UI · HDMI-2 (right): LED video surface.
 * Matches simulator split without browser chrome.
 */
export default function XT2145Display() {
  const { displayVideoSrc, playbackState } = useDisplayPlayback();
  const displayVideoLoop = useRuntimeStore((s) => s.displayVideoLoop);
  const { deviceInfo } = useRuntime();
  const touchVideos = useTouchVideos(playbackState.manifest);
  const externalSrc = displayVideoSrc ?? touchVideos.idle;
  const displayMeta = useRuntimeStore((s) => s.displayPlaybackMeta);

  return (
    <main className="flex h-full w-full flex-row overflow-hidden bg-black">
      {/* HDMI-1 · Bluefin touch (primary) */}
      <section className="relative h-full min-w-0 flex-1 overflow-hidden">
        <Home />
      </section>

      {/* HDMI-2 · LED program / ambient */}
      <section className="relative h-full min-w-0 flex-1 overflow-hidden bg-black">
        {externalSrc ? (
          <DisplayVideoPlayer
            src={externalSrc}
            label={deviceInfo?.model ?? 'HDMI-2'}
            loop={displayVideoLoop}
            screenKey={displayMeta?.screenKey ?? 'SCREEN_1'}
            mediaVersionId={displayMeta?.mediaVersionId ?? null}
            mediaTitle={displayMeta?.title ?? null}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-sm text-white/40">LED waiting for content…</p>
          </div>
        )}
      </section>
    </main>
  );
}
