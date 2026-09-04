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
  reconcileSdCacheMarksFromDisk,
} from './sdCacheBridge';
import { touchProgramMediaVersionIds } from './touchProgramGate';
import {
  checkSync,
  reportDownloadCompleteWithRetry,
  reportDownloadProgress,
  reportSyncStatus,
} from './sync';
import { isMediaSyncPaused } from './perform6Ops';

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
  /** Skip OTA apply (default on periodic sync — OTA is admin-only). */
  skipOta?: boolean;
  /** Admin Install OTA only — required to apply; never auto on sync. */
  forceOta?: boolean;
  /** Skip media downloads (OTA-only pass while media pipeline is busy). */
  skipMedia?: boolean;
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
  const mediaSyncAllowed =
    options?.skipMedia !== true &&
    (!isMediaSyncPaused() || options?.forceMediaSync === true);

  try {
    try {
      await reconcileSdCacheMarksFromDisk();
    } catch {
      /* best-effort — localStorage still used if FS list fails */
    }

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

    const adminOta = options?.forceOta === true;
    // Periodic sync never applies OTA. Admin Install must pass forceOta.
    const skipOta = !adminOta || options?.skipOta === true;

    const updateAvailable =
      syncData.runtime?.updateAvailable === true || ota.updateAvailable === true;

    if (!adminOta) {
      if (updateAvailable) {
        console.info(
          '[Perform6] OTA update available — waiting for admin Install (auto-OTA disabled)',
          { version: ota.version ?? syncData.runtime?.version },
        );
      }
    } else if (skipOta) {
      console.info(
        '[Perform6] OTA skipped — skipOta requested (media pipeline independent)',
      );
    } else if (updateAvailable) {
      console.info('[Perform6] OTA admin Install — applying (media path not cancelled)');
      try {
        await flushDeviceLogs(auth);
      } catch {
        /* best-effort */
      }
      const applied = await applyOtaUpdate(auth, {
        allowWhenPaused: true,
        clearFailCooldown: true,
      });
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
          '[Perform6] OTA failed — media continues on separate path',
          applied.error,
        );
      }
    }

    if (otaError) {
      console.info('[Perform6] Proceeding with media download after OTA failure');
    }

    if (!mediaSyncAllowed) {
      console.info(
        options?.skipMedia
          ? '[Perform6] Media download skipped — media pipeline busy or skipMedia'
          : '[Perform6] Media download skipped — pauseMediaSync in perform6-ops.json',
      );
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

    if (mediaItems.length > 0) {
      // Asset pool (preferred) or autorun perform6-cache — never OTA worker.
      // Do NOT mark DOWNLOADING at 0 bytes before transfer — Admin showed false
      // "Downloading — / 26 MB" for 16+ minutes while AssetPool hung.
      const batch = await downloadMediaBatchToSd(
        mediaItems,
        async (progress) => {
          const bytes = progress.bytesDownloaded;
          // Honest status: start (autorun ack), real byte progress, or terminal states.
          if (progress.status === 'progress' && !(bytes > 0)) return;
          if (progress.status === 'progress') {
            const lastMs = progressLastSentMs.get(progress.mediaVersionId) ?? 0;
            if (Date.now() - lastMs < PROGRESS_REPORT_INTERVAL_MS) return;
          }
          if (
            progress.status !== 'progress' &&
            progress.status !== 'start' &&
            progress.status !== 'done' &&
            progress.status !== 'skip' &&
            progress.status !== 'failed'
          ) {
            return;
          }
          progressLastSentMs.set(progress.mediaVersionId, Date.now());
          try {
            await reportDownloadProgress(auth, {
              syncJobId: syncData.syncJobId,
              mediaVersionId: progress.mediaVersionId,
              bytesDownloaded: String(Math.max(0, bytes)),
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
                'Media download failed (asset pool / SD cache)',
            });
          } catch {
            completeReportFailures += 1;
          }
        }
      }
    }

    const expectedDownloads = mediaItems.length;
    const cachedCount = mediaItems.filter((item) =>
      downloaded.includes(item.mediaVersionId) || succeeded.includes(item.mediaVersionId),
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
