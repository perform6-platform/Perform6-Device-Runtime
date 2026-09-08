import type { SyncMediaItem } from '../shared/types/api';
import {
  clearSdCached,
  hasSdCachedMedia,
  realizePoolPathToCache,
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

/** Local playback URL from SD:/perform6-media (file://) — shared Bluefin + LED. */
export async function resolveLocalPlaybackUrl(
  mediaVersionId: string,
  fallbackFileUrl?: string | null,
): Promise<string | null> {
  return resolveSdPlaybackUrl(mediaVersionId, fallbackFileUrl);
}

/** True when we have confirmed this mediaVersionId is on SD (media store .mp4). */
export async function hasLocalMediaBlob(
  mediaVersionId: string,
): Promise<boolean> {
  return hasSdCachedMedia(mediaVersionId);
}

export function revokeLocalPlaybackUrl(_mediaVersionId: string): void {
  // file:// URLs do not need revokeObjectURL
}

/**
 * Download one item via AssetPool + AssetRealizer to perform6-media/*.mp4.
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
 * After AssetPool fetch: AssetRealizer into perform6-media (BrightSign docs path).
 * No autorun led-cache-prefetch — that path depends on a dead bridge and stalls Bluefin.
 */
async function realizePoolBatchToStore(
  items: SyncMediaItem[],
  poolResult: {
    succeeded: string[];
    downloaded: string[];
    failed: string[];
    failureReasons: Record<string, string>;
  },
): Promise<{
  succeeded: string[];
  downloaded: string[];
  failed: string[];
  failureReasons: Record<string, string>;
}> {
  const poolOk = items.filter((item) =>
    poolResult.succeeded.includes(item.mediaVersionId),
  );
  const failureReasons = { ...poolResult.failureReasons };
  const failed = [...poolResult.failed];

  if (poolOk.length === 0) {
    return {
      succeeded: [],
      downloaded: [],
      failed: [...new Set(failed)],
      failureReasons,
    };
  }

  const realized = await realizeMediaAssetsViaRealizer(poolOk);
  const succeeded: string[] = [];
  const downloaded: string[] = [];

  for (const item of poolOk) {
    if (realized.succeeded.includes(item.mediaVersionId)) {
      succeeded.push(item.mediaVersionId);
      downloaded.push(item.mediaVersionId);
      continue;
    }
    if (realizePoolPathToCache(item.mediaVersionId, item.fileUrl)) {
      succeeded.push(item.mediaVersionId);
      downloaded.push(item.mediaVersionId);
      continue;
    }
    failed.push(item.mediaVersionId);
    failureReasons[item.mediaVersionId] =
      realized.failureReasons[item.mediaVersionId] ??
      'Pool fetch ok but AssetRealizer to perform6-media failed';
  }

  return {
    succeeded: [...new Set(succeeded)],
    downloaded: [...new Set(downloaded)],
    failed: [...new Set(failed)].filter((id) => !succeeded.includes(id)),
    failureReasons,
  };
}

/**
 * BrightSign-correct media path only:
 * AssetPoolFetcher (progressevent/fileevent) → AssetRealizer → SD:/perform6-media/*.mp4
 *
 * Autorun HTTP prefetch is disabled (bridge-inbound unreliable; Bluefin overlay spam).
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

  const result = await realizePoolBatchToStore(
    items,
    await downloadMediaItemsViaAssetPool(items, onProgress, options),
  );

  const missing = items.filter(
    (item) =>
      !result.succeeded.includes(item.mediaVersionId) &&
      !result.downloaded.includes(item.mediaVersionId),
  );

  if (missing.length > 0) {
    console.warn(
      '[Perform6] AssetPool/Realizer incomplete — autorun prefetch NOT used (disabled)',
      {
        missing: missing.length,
        reasons: missing.map((m) => ({
          id: m.mediaVersionId,
          reason: result.failureReasons[m.mediaVersionId] ?? 'missing',
        })),
      },
    );
    setDownloadUiState({
      phase: 'error',
      statusMessage:
        missing.length === items.length
          ? 'Media download failed (AssetPool/Realizer)'
          : `Some media failed (${missing.length}) — AssetPool/Realizer only`,
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
