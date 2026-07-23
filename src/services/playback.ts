import type { MediaAsset, PlaybackManifest, PlaybackScreen } from '../shared/types';
import type { ClusterMember, DisplayTarget } from '../shared/types';
import { CLUSTER_MEMBERS } from '../config/runtime';

export type TouchPlaybackSlot =
  | 'touch-default'
  | 'start-here'
  | 'phase1'
  | 'phase2'
  | 'full-program';

export function findTouchScreen(
  manifest: PlaybackManifest | null | undefined,
  slotId: TouchPlaybackSlot,
): PlaybackScreen | undefined {
  if (!manifest) return undefined;
  return manifest.screens.find((s) => s.id === slotId);
}

/** Synced DB URLs only — empty string when the slot has no assignment/media. */
export function resolveTouchVideoUrl(
  manifest: PlaybackManifest | null | undefined,
  slotId: TouchPlaybackSlot,
): string {
  const direct = getCurrentVideo(findTouchScreen(manifest, slotId));
  return direct?.url ?? '';
}

export function resolveTouchVideos(manifest: PlaybackManifest | null | undefined) {
  return {
    idle: resolveTouchVideoUrl(manifest, 'touch-default'),
    startHere: resolveTouchVideoUrl(manifest, 'start-here'),
    phase1: resolveTouchVideoUrl(manifest, 'phase1'),
    phase2: resolveTouchVideoUrl(manifest, 'phase2'),
    fullProgram: resolveTouchVideoUrl(manifest, 'full-program'),
  };
}

export function isBackendManifest(manifest: PlaybackManifest | null | undefined): boolean {
  return !!manifest && !manifest.version.startsWith('mock-');
}

export function findScreenForTarget(
  manifest: PlaybackManifest,
  displayTarget: DisplayTarget,
): PlaybackScreen | undefined {
  return manifest.screens.find((s) => s.displayTarget === displayTarget);
}

export function findScreenForClusterMember(
  manifest: PlaybackManifest,
  clusterMember: ClusterMember,
): PlaybackScreen | undefined {
  const byMember = manifest.screens.find((s) => s.clusterMember === clusterMember);
  if (byMember) return byMember;

  // Fallback: SCREEN_1 → DEVICE_A mapping when clusterMember was not hydrated.
  const index = CLUSTER_MEMBERS.indexOf(clusterMember);
  if (index < 0) return undefined;
  const screenKey = `SCREEN_${index + 1}`;
  return (
    manifest.screens.find((s) => s.displayTarget === screenKey) ??
    manifest.screens.find((s) => s.id === `hd226-${clusterMember}`) ??
    (manifest.screens.length === 1 ? manifest.screens[0] : undefined)
  );
}

export function getCurrentVideo(screen: PlaybackScreen | undefined): MediaAsset | null {
  if (!screen) return null;
  return screen.currentVideo ?? screen.playlist[0] ?? null;
}

export function getNextVideo(screen: PlaybackScreen, currentId: string): MediaAsset | null {
  const idx = screen.playlist.findIndex((v) => v.id === currentId);
  if (idx < 0 || screen.playlist.length === 0) return null;
  return screen.playlist[(idx + 1) % screen.playlist.length] ?? null;
}

export function createMockManifest(profile: string): PlaybackManifest {
  const baseVideos: MediaAsset[] = [
    {
      id: 'default',
      type: 'video',
      url: '/videos/warmup.mp4',
      title: 'Default Loop',
      loop: true,
    },
    {
      id: 'phase1',
      type: 'video',
      url: '/videos/phase1-gym.mp4',
      title: 'Phase 1 Session',
      durationSeconds: 1200,
    },
  ];

  return {
    version: 'mock-1',
    updatedAt: new Date().toISOString(),
    deployment: {
      id: 'dep-mock',
      name: 'Perform6 Demo Deployment',
      libraryId: 'lib-1',
      libraryName: 'Default Library',
      currentDay: 1,
      totalDays: 7,
    },
    screens:
      profile === 'XC4055'
        ? [
            {
              id: 'screen-1',
              label: 'Start Here',
              displayTarget: 'SCREEN_1',
              playlist: [baseVideos[0]!],
              currentVideo: baseVideos[0],
              rotationDay: 1,
            },
            {
              id: 'screen-2',
              label: 'Phase 1',
              displayTarget: 'SCREEN_2',
              playlist: [baseVideos[1]!],
              currentVideo: baseVideos[1],
              rotationDay: 1,
            },
            {
              id: 'screen-3',
              label: 'Phase 2',
              displayTarget: 'SCREEN_3',
              playlist: [baseVideos[0]!],
              currentVideo: baseVideos[0],
              rotationDay: 1,
            },
          ]
        : profile === 'HD226'
          ? CLUSTER_MEMBERS.slice(0, 3).map((member, i) => ({
              id: `hd226-${member}`,
              label: member,
              clusterMember: member,
              playlist: [baseVideos[i % baseVideos.length]!],
              currentVideo: baseVideos[i % baseVideos.length],
              rotationDay: 1,
            }))
          : [
              {
                id: 'touch-default',
                label: 'Touch Display Mirror',
                playlist: baseVideos,
                currentVideo: baseVideos[0],
                rotationDay: 1,
              },
            ],
  };
}
