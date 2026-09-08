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

/** Local playback URL from AssetPool path (or legacy perform6-media). */
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
 * Download one item via AssetPool (playable at GetPoolFilePath — no Realizer copy).
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
 * BrightSign surgical media path:
 * AssetPoolFetcher → mark GetPoolFilePath → LED PlayFile(pool path).
 * No AssetRealizer / Node copy (field EPERM). Autorun prefetch disabled.
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

  const missing = items.filter(
    (item) =>
      !result.succeeded.includes(item.mediaVersionId) &&
      !result.downloaded.includes(item.mediaVersionId),
  );

  if (missing.length > 0) {
    console.warn('[Perform6] AssetPool incomplete — no Realizer/prefetch fallback', {
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
