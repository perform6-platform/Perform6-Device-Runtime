import type { HardwareProfile, PlaybackManifest } from '../shared/types';
import type { SyncCheckResponseData } from '../shared/types/api';
import { buildRuntimeManifest } from './manifest';

const KEY = 'perform6-playback-manifest';

type OfflineManifestSource = Pick<
  SyncCheckResponseData,
  'device' | 'deployment' | 'config' | 'playbackManifest' | 'targetManifest' | 'schedule'
>;

interface CachedPlaybackState {
  savedAt: string;
  manifest: PlaybackManifest;
  source?: OfflineManifestSource;
  profile?: HardwareProfile;
}

function offlineSource(syncData: SyncCheckResponseData): OfflineManifestSource {
  return {
    device: syncData.device
      ? {
          id: syncData.device.id,
          rotationStartDate:
            syncData.device.effectiveRotationStartDate ??
            syncData.device.rotationStartDate,
          scheduleTimeZone: syncData.device.scheduleTimeZone ?? 'UTC',
          rotationCycleDays: syncData.device.rotationCycleDays ?? 36,
          // Do not persist the server's point-in-time rotation day. Offline
          // boot derives today's civil date in scheduleTimeZone.
        }
      : undefined,
    deployment: syncData.deployment,
    config: syncData.config,
    playbackManifest: syncData.playbackManifest,
    targetManifest: syncData.targetManifest,
    schedule: syncData.schedule,
  };
}

/** Persist last successful sync manifest so UI can play SD-cached clips offline after reboot. */
export function savePlaybackManifestCache(
  manifest: PlaybackManifest,
  syncData?: SyncCheckResponseData | null,
  profile?: HardwareProfile,
): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        manifest,
        source: syncData ? offlineSource(syncData) : undefined,
        profile,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadPlaybackManifestCache(profile?: HardwareProfile): PlaybackManifest | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedPlaybackState>;
    if (!parsed?.manifest?.screens || !Array.isArray(parsed.manifest.screens)) {
      return null;
    }

    const sourceProfile = profile ?? parsed.profile;
    if (parsed.source && sourceProfile) {
      const rebuilt = buildRuntimeManifest(
        {
          syncJobId: parsed.manifest.version,
          ...parsed.source,
        },
        sourceProfile,
      );
      if (rebuilt) return rebuilt;
    }

    // Backward compatibility for the manifest-only cache written by 1.5.81.
    return parsed.manifest;
  } catch {
    return null;
  }
}

export function clearPlaybackManifestCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
