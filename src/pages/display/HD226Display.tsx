import { DisplayVideoPlayer } from '../../display-ui';
import { findScreenForClusterMember, getCurrentVideo } from '../../services/playback';
import { useOfflineVideoSrc } from '../../hooks/useOfflineVideoSrc';
import { runtimeConfig, CLUSTER_MEMBERS } from '../../config/runtime';
import { useRuntime, useSync } from '../../hooks/useRuntime';

/**
 * Production HD226 surface — fullscreen playback for the baked
 * VITE_CLUSTER_MEMBER (DEVICE_A…J). One SD package = one cluster player.
 */
export default function HD226Display() {
  const { store } = useRuntime();
  const { syncState } = useSync();
  const manifest = store.playbackState.manifest;
  const member = runtimeConfig.clusterMember;

  const screen = manifest
    ? findScreenForClusterMember(manifest, member)
    : undefined;
  const video = getCurrentVideo(screen);
  const offlineSrc = useOfflineVideoSrc(video?.id, video?.url);
  const videoSrc = offlineSrc;
  const label = screen?.label ?? member;
  const screenKey =
    screen?.displayTarget ??
    `SCREEN_${CLUSTER_MEMBERS.indexOf(member) + 1}`;

  return (
    <main className="flex h-full w-full flex-col bg-black">
      {videoSrc ? (
        <div className="min-h-0 flex-1">
          <DisplayVideoPlayer
            src={videoSrc}
            label={label}
            loop
            screenKey={screenKey}
            mediaVersionId={video?.id ?? null}
            mediaTitle={video?.title ?? null}
          />
        </div>
      ) : (
        <section className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm font-semibold text-slate-200">{label}</p>
          <p className="max-w-md text-xs text-slate-500">
            {manifest
              ? `No video for ${member} yet. Phase: ${syncState.runtimePhase}`
              : `Waiting for sync… Phase: ${syncState.runtimePhase}`}
          </p>
        </section>
      )}
    </main>
  );
}
