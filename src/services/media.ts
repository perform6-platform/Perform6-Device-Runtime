import type { SyncMediaItem } from '../shared/types/api';
import {
  clearSdCached,
  hasSdCachedMedia,
  resolveSdPlaybackUrl,
  type SdDownloadProgress,
} from './sdCacheBridge';
import {
  downloadMediaItemsViaAssetPool,
  isMediaAssetPoolAvailable,
} from './mediaAssetPool';
import { realizeMediaAssetsViaRealizer } from './mediaRealize';
import { resolveMediaFileUrl } from './manifest';
import { offlineCacheService } from './offlineCache';
import { MEDIA_CAPACITY_RESERVE_BYTES } from './mediaStorePaths';
import { refreshSdStorageInfo } from './sdStorageInfo';
import { resetDownloadUiState, setDownloadUiState } from './downloadProgress';

export interface CachedMediaMeta {
  assetId: string;
  url: string;
  type: 'video';
  cachedAt: string;
  sizeBytes?: number;
  checksum?: string;
}

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number | null;
}

/** Local playback URL from the extension-bearing realized media store. */
export async function resolveLocalPlaybackUrl(
  mediaVersionId: string,
  fallbackFileUrl?: string | null,
): Promise<string | null> {
  return resolveSdPlaybackUrl(mediaVersionId, fallbackFileUrl);
}

/** True when mediaVersionId is on SD (pool path or legacy .mp4). */
export async function hasLocalMediaBlob(
  mediaVersionId: string,
): Promise<boolean> {
  return hasSdCachedMedia(mediaVersionId);
}

export function revokeLocalPlaybackUrl(_mediaVersionId: string): void {
  // file:// URLs do not need revokeObjectURL
}

/**
 * Download one item via AssetPool, then realize it to an extension-bearing file.
 */
export async function downloadMediaItem(
  item: SyncMediaItem,
  onProgress?: (progress: DownloadProgress) => void | Promise<void>,
): Promise<number> {
  const { succeeded, failed } = await downloadMediaBatchToSd([item], async (p) => {
    await onProgress?.({
      bytesDownloaded: p.bytesDownloaded,
      totalBytes: p.totalBytes,
    });
  });
  if (failed.includes(item.mediaVersionId) || !succeeded.includes(item.mediaVersionId)) {
    throw new Error('SD media download failed');
  }
  const size = item.fileSize != null ? Number(item.fileSize) : 0;
  await offlineCacheService.storeMediaMeta({
    assetId: item.mediaVersionId,
    url: resolveMediaFileUrl(item.fileUrl),
    type: 'video',
    cachedAt: new Date().toISOString(),
    sizeBytes: size || undefined,
    checksum: item.checksum,
  });
  return size;
}

async function assertCapacityForDownload(
  items: SyncMediaItem[],
): Promise<string | null> {
  const needBytes = items.reduce((sum, item) => {
    if (hasSdCachedMedia(item.mediaVersionId)) return sum;
    const n = item.fileSize != null ? Number(item.fileSize) : 0;
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
  if (needBytes <= 0) return null;

  const snap = await refreshSdStorageInfo(6_000);
  if (!snap || snap.freeBytes <= 0) return null;

  const required = needBytes + MEDIA_CAPACITY_RESERVE_BYTES;
  if (snap.freeBytes >= required) return null;

  return (
    `SD capacity: need ~${Math.ceil(required / 1048576)} MB ` +
    `(download ${Math.ceil(needBytes / 1048576)} MB + reserve) ` +
    `but only ${snap.freeMb} MB free`
  );
}

/**
 * BrightSign media path:
 * AssetPoolFetcher → AssetRealizer → perform6-media/<stable-name>.mp4.
 *
 * The XT2145 field player rejects extensionless AssetPool SHA256 objects in
 * native roVideoPlayer.PlayFile even though the HTML widget can read them.
 * AssetRealizer is the BrightSign-supported way to expose the downloaded pool
 * object under its manifest name; do not use Node copyFile (EPERM on the pool).
 */
export async function downloadMediaBatchToSd(
  items: SyncMediaItem[],
  onProgress?: (progress: SdDownloadProgress) => void | Promise<void>,
  options?: { manifest?: import('../shared/types').PlaybackManifest | null },
): Promise<{
  succeeded: string[];
  downloaded: string[];
  failed: string[];
  failureReasons: Record<string, string>;
}> {
  if (items.length === 0) {
    return { succeeded: [], downloaded: [], failed: [], failureReasons: {} };
  }

  const capacityError = await assertCapacityForDownload(items);
  if (capacityError) {
    console.warn('[Perform6] Media download blocked — capacity', capacityError);
    setDownloadUiState({
      phase: 'error',
      statusMessage: capacityError,
      totalFiles: items.length,
      completedFiles: 0,
    });
    return {
      succeeded: [],
      downloaded: [],
      failed: items.map((i) => i.mediaVersionId),
      failureReasons: Object.fromEntries(
        items.map((i) => [i.mediaVersionId, capacityError]),
      ),
    };
  }

  if (!isMediaAssetPoolAvailable()) {
    const reason =
      'Media asset pool unavailable — BrightSign AssetPool required (autorun prefetch disabled)';
    console.warn('[Perform6]', reason);
    setDownloadUiState({
      phase: 'error',
      statusMessage: reason,
      totalFiles: items.length,
      completedFiles: 0,
    });
    return {
      succeeded: [],
      downloaded: [],
      failed: items.map((i) => i.mediaVersionId),
      failureReasons: Object.fromEntries(
        items.map((i) => [i.mediaVersionId, reason]),
      ),
    };
  }

  const result = await downloadMediaItemsViaAssetPool(items, onProgress, options);

  // Run for every pool-success item, including assets downloaded by an earlier
  // release. This lets an OTA update repair the field player without downloading
  // multi-GB media again.
  const poolReadyIds = new Set([
    ...result.succeeded,
    ...result.downloaded,
  ]);
  const poolReadyItems = items.filter((item) =>
    poolReadyIds.has(item.mediaVersionId),
  );
  const realized = await realizeMediaAssetsViaRealizer(poolReadyItems);
  const realizedIds = new Set(realized.succeeded);

  result.succeeded = result.succeeded.filter((id) => realizedIds.has(id));
  for (const id of realized.failed) {
    if (!result.failed.includes(id)) result.failed.push(id);
    result.failureReasons[id] =
      realized.failureReasons[id] ?? 'AssetRealizer did not produce playable media';
  }

  const missing = items.filter(
    (item) =>
      !result.succeeded.includes(item.mediaVersionId) &&
      !result.downloaded.includes(item.mediaVersionId),
  );

  if (missing.length > 0) {
    console.warn('[Perform6] Media pipeline incomplete — pool or realization failed', {
      missing: missing.length,
      reasons: missing.map((m) => ({
        id: m.mediaVersionId,
        reason: result.failureReasons[m.mediaVersionId] ?? 'missing',
      })),
    });
    setDownloadUiState({
      phase: 'error',
      statusMessage:
        missing.length === items.length
          ? 'Media download failed (AssetPool)'
          : `Some media failed (${missing.length}) — AssetPool only`,
      totalFiles: items.length,
      completedFiles: result.succeeded.length,
    });
  } else {
    resetDownloadUiState();
  }

  for (const item of items) {
    if (!result.downloaded.includes(item.mediaVersionId)) continue;
    await offlineCacheService.storeMediaMeta({
      assetId: item.mediaVersionId,
      url: resolveMediaFileUrl(item.fileUrl),
      type: 'video',
      cachedAt: new Date().toISOString(),
      sizeBytes: item.fileSize != null ? Number(item.fileSize) : undefined,
      checksum: item.checksum,
    });
  }
  return result;
}

export async function evictCachedMedia(mediaVersionIds: string[]): Promise<void> {
  if (mediaVersionIds.length === 0) return;
  clearSdCached(mediaVersionIds);
  await offlineCacheService.removeMany(mediaVersionIds);
}

/** @deprecated Use downloadMediaItem — kept for tests */
export async function simulateDownload(item: SyncMediaItem): Promise<CachedMediaMeta> {
  const bytes = await downloadMediaItem(item);
  return {
    assetId: item.mediaVersionId,
    url: resolveMediaFileUrl(item.fileUrl),
    type: 'video',
    cachedAt: new Date().toISOString(),
    sizeBytes: bytes,
    checksum: item.checksum,
  };
}
