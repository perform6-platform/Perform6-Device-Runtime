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
import {
  clearSdCached,
  hasSdCachedMedia,
  listSdCachedMediaVersionIds,
  markSdCached,
} from './sdCacheBridge';
import {
  checkSync,
  reportDownloadCompleteWithRetry,
  reportDownloadProgress,
  reportSyncStatus,
} from './sync';

export interface SyncEngineResult {
  success: boolean;
  manifest: PlaybackManifest | null;
  syncData: SyncCheckResponseData | null;
  ota?: Awaited<ReturnType<typeof checkOtaUpdate>>;
  error?: string;
  completeReportFailures?: number;
}

export async function runSyncEngine(
  auth: DeviceAuthContext,
  profile: HardwareProfile,
): Promise<SyncEngineResult> {
  const startMs = Date.now();
  let completeReportFailures = 0;

  try {
    const claimedIds = [
      ...new Set([...getCachedMediaVersionIds(), ...listSdCachedMediaVersionIds()]),
    ];
    const verifiedCachedIds: string[] = [];
    for (const id of claimedIds) {
      if (hasSdCachedMedia(id)) {
        verifiedCachedIds.push(id);
      } else {
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

    const mediaItems = [...(syncData.media ?? [])].sort((a, b) => {
      const rank = (role?: string) =>
        role === 'current' ? 0 : role === 'prefetch' ? 1 : 2;
      return rank(a.weekRole) - rank(b.weekRole);
    });

    const downloadStart = Date.now();
    let succeeded: string[] = [];
    let failed: string[] = [];

    if (mediaItems.length > 0) {
      // One SD keep-set + download pass. Already-cached files report status=skip.
      const batch = await downloadMediaBatchToSd(
        mediaItems,
        async (progress) => {
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
      );
      succeeded = batch.succeeded;
      failed = batch.failed;

      for (const item of mediaItems) {
        if (succeeded.includes(item.mediaVersionId) || hasSdCachedMedia(item.mediaVersionId)) {
          markSdCached(item.mediaVersionId, item.fileUrl);
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
              errorMessage: 'SD:/perform6-cache download failed',
            });
          } catch {
            completeReportFailures += 1;
          }
        }
      }
    }

    const expectedDownloads = mediaItems.length;
    const cachedCount = mediaItems.filter(
      (item) =>
        succeeded.includes(item.mediaVersionId) || hasSdCachedMedia(item.mediaVersionId),
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

    const manifest = buildRuntimeManifest(syncData, profile);
    const ota = await checkOtaUpdate(syncData.runtime ?? null);

    return {
      success: true,
      manifest,
      syncData,
      ota,
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
