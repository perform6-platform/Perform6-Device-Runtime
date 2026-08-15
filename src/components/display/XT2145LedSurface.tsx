import { DisplayVideoPlayer } from '../../display-ui';
import { useDisplayPlayback } from '../../hooks/useRuntime';
import { useTouchVideos } from '../../hooks/useOfflineVideoSrc';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { IndependentLedSurface } from './IndependentLedSurface';
import { runtimeConfig } from '../../config/runtime';

function XT2145SharedLedSurface() {
  const { displayVideoSrc, playbackState } = useDisplayPlayback();
  const displayVideoLoop = useRuntimeStore((s) => s.displayVideoLoop);
  const touchVideos = useTouchVideos(playbackState.manifest);
  const externalSrc = displayVideoSrc ?? touchVideos.idle;
  const displayMeta = useRuntimeStore((s) => s.displayPlaybackMeta);

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

/**
 * XT2145 HDMI-2 LED surface. Independent LED widgets use the relay-driven
 * surface; shared-process / simulator contexts can fall back to touch idle.
 */
export function XT2145LedSurface() {
  if (
    !runtimeConfig.isSimulator &&
    runtimeConfig.hardwareProfile === 'XT2145' &&
    runtimeConfig.xtOutputRole === 'led'
  ) {
    return <IndependentLedSurface />;
  }
  return <XT2145SharedLedSurface />;
}
