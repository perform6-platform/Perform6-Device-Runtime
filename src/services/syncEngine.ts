import type { DeviceAuthContext, SyncCheckResponseData } from '../shared/types/api';
import type { HardwareProfile, PlaybackManifest } from '../shared/types';
import {
  addCachedMediaVersionId,
  buildRuntimeManifest,
  getCachedMediaVersionIds,
  removeCachedMediaVersionIds,
} from './manifest';
import { downloadMediaBatchToSd, evictCachedMedia } from './media';
import { checkOtaUpdate } from './ota';
import { applyOtaUpdate } from './otaApply';
import { flushDeviceLogs } from './deviceLogsApi';
import {
  clearSdCached,
  getConfirmedCachedMediaVersionIds,
  hasSdCachedMedia,
  listSdCachedMediaVersionIds,
} from './sdCacheBridge';
import { touchProgramMediaVersionIds } from './touchProgramGate';
import {
  checkSync,
  reportDownloadCompleteWithRetry,
  reportDownloadProgress,
  reportSyncStatus,
} from './sync';
import { isMediaSyncPaused, isOtaPaused } from './perform6Ops';

export interface SyncEngineResult {
  success: boolean;
  manifest: PlaybackManifest | null;
  syncData: SyncCheckResponseData | null;
  ota?: Awaited<ReturnType<typeof checkOtaUpdate>>;
  otaApplied?: boolean;
  otaError?: string;
  error?: string;
  completeReportFailures?: number;
}

export interface SyncEngineHooks {
  /** Apply playlist as soon as sync-check returns — do not wait for the full SD fill. */
  onManifest?: (manifest: PlaybackManifest | null) => void;
}

export interface SyncEngineOptions {
  /** Bypass pauseMediaSync for a one-shot sync (syncOnBoot). */
  forceMediaSync?: boolean;
}

function p0MediaVersionIds(
  manifest: PlaybackManifest | null,
  profile: HardwareProfile,
): Set<string> {
  const ids = new Set<string>();
  if (!manifest) return ids;

  if (profile === 'XT2145') {
    const idle = manifest.screens.find((screen) => screen.id === 'touch-default');
    if (idle?.currentVideo?.id) ids.add(idle.currentVideo.id);
    return ids;
  }

  if (profile === 'XC4055') {
    for (const screen of manifest.screens) {
      const target = screen.displayTarget;
      if (
        (target === 'SCREEN_1' || target === 'SCREEN_2' || target === 'SCREEN_3') &&
        screen.currentVideo?.id
      ) {
        ids.add(screen.currentVideo.id);
      }
    }
    return ids;
  }

  for (const screen of manifest.screens) {
    if (screen.currentVideo?.id) ids.add(screen.currentVideo.id);
  }
  return ids;
}

export async function runSyncEngine(
  auth: DeviceAuthContext,
  profile: HardwareProfile,
  hooks?: SyncEngineHooks,
  options?: SyncEngineOptions,
): Promise<SyncEngineResult> {
  const startMs = Date.now();
  let completeReportFailures = 0;
  const mediaSyncAllowed = !isMediaSyncPaused() || options?.forceMediaSync === true;

  try {
    const claimedIds = [
      ...new Set([...getCachedMediaVersionIds(), ...listSdCachedMediaVersionIds()]),
    ];
    const verifiedCachedIds = getConfirmedCachedMediaVersionIds().filter(
      (id) => hasSdCachedMedia(id) && claimedIds.includes(id),
    );
    for (const id of claimedIds) {
      if (!hasSdCachedMedia(id) || !verifiedCachedIds.includes(id)) {
        removeCachedMediaVersionIds([id]);
        clearSdCached([id]);
      }
    }

    const syncData = await checkSync(auth, {
      cachedMediaVersionIds: verifiedCachedIds,
    });

    if (syncData.evictMediaVersionIds?.length) {
      await evictCachedMedia(syncData.evictMediaVersionIds);
      removeCachedMediaVersionIds(syncData.evictMediaVersionIds);
    }

    const manifest = buildRuntimeManifest(syncData, profile);
    hooks?.onManifest?.(manifest);

    const ota = await checkOtaUpdate(syncData.runtime ?? null);
    let otaApplied = false;
    let otaError: string | undefined;

    if (
      !isOtaPaused() &&
      (syncData.runtime?.updateAvailable || ota.updateAvailable)
    ) {
      console.info('[Perform6] OTA update available — applying before media downloads');
      try {
        await flushDeviceLogs(auth);
      } catch {
        /* best-effort */
      }
      const applied = await applyOtaUpdate(auth);
      if (applied.applied) {
        return {
          success: true,
          manifest,
          syncData,
          ota: { ...ota, version: applied.version ?? ota.version },
          otaApplied: true,
          completeReportFailures,
        };
      }
      if (applied.error) {
        otaError = applied.error;
        console.warn(
          '[Perform6] OTA failed before media — continuing with video sync',
          applied.error,
        );
      }
    }

    const onAirIds = p0MediaVersionIds(manifest, profile);
    const programIds =
      profile === 'XT2145' ? touchProgramMediaVersionIds(manifest) : new Set<string>();

    const mediaItems = [...(syncData.media ?? [])].sort((a, b) => {
      const rank = (id: string, role?: string) => {
        if (onAirIds.has(id)) return 0;
        if (programIds.has(id)) return 1;
        if (role === 'current' || !role) return 2;
        if (role === 'prefetch') return 3;
        return 4;
      };
      return rank(a.mediaVersionId, a.weekRole) - rank(b.mediaVersionId, b.weekRole);
    });

    const downloadStart = Date.now();
    let succeeded: string[] = [];
    let downloaded: string[] = [];
    let failed: string[] = [];

    const progressLastSentMs = new Map<string, number>();
    const PROGRESS_REPORT_INTERVAL_MS = 3000;

    if (mediaItems.length > 0 && mediaSyncAllowed) {
      // One SD keep-set + download pass. Already-cached files report status=skip.
      const batch = await downloadMediaBatchToSd(
        mediaItems,
        async (progress) => {
          if (progress.status === 'progress') {
            const lastMs = progressLastSentMs.get(progress.mediaVersionId) ?? 0;
            if (Date.now() - lastMs < PROGRESS_REPORT_INTERVAL_MS) return;
          }
          progressLastSentMs.set(progress.mediaVersionId, Date.now());
          try {
            await reportDownloadProgress(auth, {
              syncJobId: syncData.syncJobId,
              mediaVersionId: progress.mediaVersionId,
              bytesDownloaded: String(progress.bytesDownloaded),
              totalBytes:
                progress.totalBytes != null
                  ? String(progress.totalBytes)
                  : undefined,
              phase: 'DOWNLOADING',
            });
          } catch {
            /* best-effort */
          }
        },
        { manifest },
      );
      succeeded = batch.succeeded;
      downloaded = batch.downloaded;
      failed = batch.failed;
      const failureReasons = batch.failureReasons;

      for (const item of mediaItems) {
        if (downloaded.includes(item.mediaVersionId)) {
          addCachedMediaVersionId(item.mediaVersionId);
          try {
            await reportDownloadCompleteWithRetry(auth, {
              syncJobId: syncData.syncJobId,
              mediaVersionId: item.mediaVersionId,
              status: 'SUCCESS',
              bytesDownloaded:
                item.fileSize != null ? String(item.fileSize) : '0',
              durationMs: Date.now() - downloadStart,
            });
          } catch {
            completeReportFailures += 1;
          }
        } else if (succeeded.includes(item.mediaVersionId)) {
          addCachedMediaVersionId(item.mediaVersionId);
          try {
            await reportDownloadCompleteWithRetry(auth, {
              syncJobId: syncData.syncJobId,
              mediaVersionId: item.mediaVersionId,
              status: 'SUCCESS',
              bytesDownloaded:
                item.fileSize != null ? String(item.fileSize) : '0',
              durationMs: Date.now() - downloadStart,
            });
          } catch {
            completeReportFailures += 1;
          }
        } else if (failed.includes(item.mediaVersionId)) {
          try {
            await reportDownloadCompleteWithRetry(auth, {
              syncJobId: syncData.syncJobId,
              mediaVersionId: item.mediaVersionId,
              status: 'FAILED',
              durationMs: Date.now() - downloadStart,
              errorMessage:
                failureReasons[item.mediaVersionId] ??
                'SD:/perform6-cache download failed',
            });
          } catch {
            completeReportFailures += 1;
          }
        }
      }
    } else if (mediaItems.length > 0 && !mediaSyncAllowed) {
      console.info('[Perform6] Media download skipped — pauseMediaSync in perform6-ops.json');
    }

    const expectedDownloads = mediaSyncAllowed ? mediaItems.length : 0;
    const cachedCount = mediaItems.filter((item) =>
      downloaded.includes(item.mediaVersionId),
    ).length;
    const failedCount = mediaItems.filter((item) =>
      failed.includes(item.mediaVersionId),
    ).length;

    await reportSyncStatus(auth, {
      syncJobId: syncData.syncJobId,
      status:
        expectedDownloads > 0 && cachedCount === 0 && failedCount > 0
          ? 'FAILED'
          : 'SUCCESS',
      message:
        expectedDownloads > 0
          ? `Cached ${cachedCount}/${expectedDownloads} media files`
          : undefined,
    });

    try {
      await flushDeviceLogs(auth);
    } catch {
      /* best-effort */
    }

    return {
      success: true,
      manifest,
      syncData,
      ota,
      otaApplied,
      otaError,
      completeReportFailures,
    };
  } catch (e) {
    return {
      success: false,
      manifest: null,
      syncData: null,
      error: e instanceof Error ? e.message : 'Sync failed',
      completeReportFailures,
    };
  } finally {
    void startMs;
  }
}
