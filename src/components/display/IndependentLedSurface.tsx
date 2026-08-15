import { DisplayVideoPlayer } from '../../display-ui';
import { useDisplayPlayback } from '../../hooks/useRuntime';
import { useRuntimeStore } from '../../stores/runtimeStore';

/**
 * Playback-only surface for an independent HDMI HtmlWidget
 * (XT HDMI-2, XC HDMI-2/3). Content arrives via the local BrightSign relay.
 */
export function IndependentLedSurface() {
  const { displayVideoSrc } = useDisplayPlayback();
  const displayVideoLoop = useRuntimeStore((s) => s.displayVideoLoop);
  const displayMeta = useRuntimeStore((s) => s.displayPlaybackMeta);
  const externalSrc = displayVideoSrc ?? displayMeta?.fallbackSrc ?? null;

  return (
    <section className="relative h-full w-full overflow-hidden bg-black">
      {externalSrc ? (
        <DisplayVideoPlayer
          src={externalSrc}
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
  );
}
