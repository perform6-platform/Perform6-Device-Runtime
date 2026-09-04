import type { SyncMediaItem } from '../shared/types/api';
import {
  clearSdCached,
  downloadMediaItemsToSd,
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

/** Local playback URL from media asset pool or SD:/perform6-cache (file://). */
export async function resolveLocalPlaybackUrl(
  mediaVersionId: string,
  fallbackFileUrl?: string | null,
): Promise<string | null> {
  return resolveSdPlaybackUrl(mediaVersionId, fallbackFileUrl);
}

/** True when we have confirmed this mediaVersionId is on SD. */
export async function hasLocalMediaBlob(
  mediaVersionId: string,
): Promise<boolean> {
  return hasSdCachedMedia(mediaVersionId);
}

export function revokeLocalPlaybackUrl(_mediaVersionId: string): void {
  // file:// URLs do not need revokeObjectURL
}

/**
 * Download one item via BrightSign media asset pool (or autorun cache fallback).
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

function mergeBatchResults(
  a: {
    succeeded: string[];
    downloaded: string[];
    failed: string[];
    failureReasons: Record<string, string>;
  },
  b: {
    succeeded: string[];
    downloaded: string[];
    failed: string[];
    failureReasons: Record<string, string>;
  },
): {
  succeeded: string[];
  downloaded: string[];
  failed: string[];
  failureReasons: Record<string, string>;
} {
  const succeeded = [...new Set([...a.succeeded, ...b.succeeded])];
  const downloaded = [...new Set([...a.downloaded, ...b.downloaded])];
  const failureReasons = { ...a.failureReasons, ...b.failureReasons };
  for (const id of succeeded) delete failureReasons[id];
  const failed = [...new Set([...a.failed, ...b.failed])].filter(
    (id) => !succeeded.includes(id),
  );
  return { succeeded, downloaded, failed, failureReasons };
}

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

  // BrightSign asset pool first (sd/perform6-media-pool). OTA stays separate.
  // On pool fail/stall/partial → autorun SD:/perform6-cache (proven path).
  let result = isMediaAssetPoolAvailable()
    ? await downloadMediaItemsViaAssetPool(items, onProgress, options)
    : {
        succeeded: [] as string[],
        downloaded: [] as string[],
        failed: items.map((i) => i.mediaVersionId),
        failureReasons: Object.fromEntries(
          items.map((i) => [i.mediaVersionId, 'Media asset pool unavailable']),
        ),
      };

  const missing = items.filter(
    (item) =>
      !result.succeeded.includes(item.mediaVersionId) &&
      !result.downloaded.includes(item.mediaVersionId),
  );

  if (missing.length > 0) {
    console.warn(
      '[Perform6] Media asset pool incomplete — falling back to autorun perform6-cache',
      {
        missing: missing.length,
        reasons: missing.map((m) => ({
          id: m.mediaVersionId,
          reason: result.failureReasons[m.mediaVersionId] ?? 'missing',
        })),
      },
    );
    const cacheResult = await downloadMediaItemsToSd(missing, onProgress, options);
    result = mergeBatchResults(result, cacheResult);
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
  // Physical SD delete: asset-pool prune on next protect+fetch, or autorun keep-set.
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
