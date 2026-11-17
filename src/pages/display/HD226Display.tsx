import { DisplayVideoPlayer } from '../../display-ui';
import { findScreenForClusterMember, getCurrentVideo } from '../../services/playback';
import { useOfflineVideoSrc } from '../../hooks/useOfflineVideoSrc';
import { runtimeConfig, CLUSTER_MEMBERS } from '../../config/runtime';
import { useRuntime } from '../../hooks/useRuntime';
import perform6Logo from '../../assets/Perform6-approved-logo.svg';

/**
 * Production HD226 surface — fullscreen playback for the baked
 * VITE_CLUSTER_MEMBER (DEVICE_A…J). One SD package = one cluster player.
 */
export default function HD226Display() {
  const { store } = useRuntime();
  const manifest = store.playbackState.manifest;
  const member = runtimeConfig.clusterMember;

  const screen = manifest
    ? findScreenForClusterMember(manifest, member)
    : undefined;
  const video = getCurrentVideo(screen);
  const offlineSrc = useOfflineVideoSrc(video?.id, video?.url);
  const videoSrc = offlineSrc;
  const screenKey =
    screen?.displayTarget ??
    `SCREEN_${CLUSTER_MEMBERS.indexOf(member) + 1}`;

  return (
    <main className="flex h-full w-full flex-col bg-black">
      {videoSrc ? (
        <div className="min-h-0 flex-1">
          <DisplayVideoPlayer
            src={videoSrc}
            loop
            screenKey={screenKey}
            mediaVersionId={video?.id ?? null}
            mediaTitle={video?.title ?? null}
          />
        </div>
      ) : (
        <section className="flex h-full w-full items-center justify-center bg-black">
          <img
            src={perform6Logo}
            alt="Perform6"
            className="h-auto w-[min(44vw,1680px)] object-contain"
            draggable={false}
          />
        </section>
      )}
    </main>
  );
}
