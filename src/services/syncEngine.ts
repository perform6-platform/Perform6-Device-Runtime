import type { DeviceAuthContext, SyncCheckResponseData } from '../shared/types/api';
import type { HardwareProfile, PlaybackManifest } from '../shared/types';
import {
  addCachedMediaVersionId,
  buildRuntimeManifest,
  getCachedMediaVersionIds,
  removeCachedMediaVersionIds,
} from './manifest';
import { downloadMediaItem, evictCachedMedia, hasLocalMediaBlob } from './media';
import { checkOtaUpdate } from './ota';
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
  /** Completes that failed after retries — admin may still show MISSING until next sync. */
  completeReportFailures?: number;
}

export async function runSyncEngine(
  auth: DeviceAuthContext,
  profile: HardwareProfile,
): Promise<SyncEngineResult> {
  const startMs = Date.now();
  let completeReportFailures = 0;

  try {
    // Only report IDs that still have a local blob — never trust localStorage alone.
    const claimedIds = getCachedMediaVersionIds();
    const verifiedCachedIds: string[] = [];
    for (const id of claimedIds) {
      if (await hasLocalMediaBlob(id)) {
        verifiedCachedIds.push(id);
      } else {
        removeCachedMediaVersionIds([id]);
      }
    }

    const syncData = await checkSync(auth, {
      cachedMediaVersionIds: verifiedCachedIds,
    });

    if (syncData.evictMediaVersionIds?.length) {
      await evictCachedMedia(syncData.evictMediaVersionIds);
      removeCachedMediaVersionIds(syncData.evictMediaVersionIds);
    }

    const toDownload: NonNullable<SyncCheckResponseData['media']> = [];
    const alreadyLocal: NonNullable<SyncCheckResponseData['media']> = [];

    const mediaItems = [...(syncData.media ?? [])].sort((a, b) => {
      const rank = (role?: string) =>
        role === 'current' ? 0 : role === 'prefetch' ? 1 : 2;
      return rank(a.weekRole) - rank(b.weekRole);
    });

    for (const item of mediaItems) {
      if (item.cached) {
        const locallyPresent = await hasLocalMediaBlob(item.mediaVersionId);
        if (locallyPresent) {
          alreadyLocal.push(item);
          continue;
        }
        // Stale localStorage / server-side cache claim — force re-download.
        removeCachedMediaVersionIds([item.mediaVersionId]);
      } else {
        const locallyPresent = await hasLocalMediaBlob(item.mediaVersionId);
        if (locallyPresent) {
          // Blob exists but server does not know yet (e.g. played via fileUrl
          // fallback earlier, or download-complete never landed).
          alreadyLocal.push(item);
          continue;
        }
      }
      toDownload.push(item);
    }

    // Re-affirm local cache to the server so admin "Required media" shows CACHED.
    for (const item of alreadyLocal) {
      addCachedMediaVersionId(item.mediaVersionId);
      try {
        await reportDownloadCompleteWithRetry(auth, {
          syncJobId: syncData.syncJobId,
          mediaVersionId: item.mediaVersionId,
          status: 'SUCCESS',
          bytesDownloaded: item.fileSize != null ? String(item.fileSize) : '0',
        });
      } catch {
        completeReportFailures += 1;
        // Playback can continue offline; next sync will re-affirm.
      }
    }

    for (const item of toDownload) {
      const downloadStart = Date.now();
      try {
        const bytesDownloaded = await downloadMediaItem(item, async (progress) => {
          try {
            await reportDownloadProgress(auth, {
              syncJobId: syncData.syncJobId,
              mediaVersionId: item.mediaVersionId,
              bytesDownloaded: String(progress.bytesDownloaded),
              totalBytes:
                progress.totalBytes != null ? String(progress.totalBytes) : undefined,
              phase: 'DOWNLOADING',
            });
          } catch {
            // Progress is best-effort; complete is durable.
          }
        });
        addCachedMediaVersionId(item.mediaVersionId);

        try {
          await reportDownloadCompleteWithRetry(auth, {
            syncJobId: syncData.syncJobId,
            mediaVersionId: item.mediaVersionId,
            status: 'SUCCESS',
            bytesDownloaded: String(bytesDownloaded),
            durationMs: Date.now() - downloadStart,
          });
        } catch {
          completeReportFailures += 1;
        }
      } catch (downloadError) {
        try {
          await reportDownloadCompleteWithRetry(auth, {
            syncJobId: syncData.syncJobId,
            mediaVersionId: item.mediaVersionId,
            status: 'FAILED',
            durationMs: Date.now() - downloadStart,
            errorMessage:
              downloadError instanceof Error
                ? downloadError.message
                : 'Download failed',
          });
        } catch {
          completeReportFailures += 1;
        }
      }
    }

    await reportSyncStatus(auth, {
      syncJobId: syncData.syncJobId,
      status: 'SUCCESS',
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
