import type { SyncMediaItem } from '../shared/types/api';
import {
  clearSdCached,
  downloadMediaItemsToSd,
  getMediaPoolPath,
  hasSdCachedMedia,
  realizePoolPathToCache,
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
 * Download one item via AssetPool (BrightSign events) then realize to perform6-media/*.mp4.
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

/**
 * Capacity gate (BrightSign docs: free space in MB / reserve before download).
 * current on-disk playable assets are already counted in "used"; we only need
 * bytes still missing + working reserve to fit in free space.
 */
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
  if (!snap || snap.freeBytes <= 0) return null; // unknown — autorun still gates HTTP path

  const required = needBytes + MEDIA_CAPACITY_RESERVE_BYTES;
  if (snap.freeBytes >= required) return null;

  return (
    `SD capacity: need ~${Math.ceil(required / 1048576)} MB ` +
    `(download ${Math.ceil(needBytes / 1048576)} MB + reserve) ` +
    `but only ${snap.freeMb} MB free`
  );
}

/**
 * Realize pool staging into perform6-media/*.mp4 (single store). Only then playable.
 */
function realizePoolBatchToCache(
  items: SyncMediaItem[],
  poolResult: {
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
  const succeeded: string[] = [];
  const downloaded: string[] = [];
  const failed = [...poolResult.failed];
  const failureReasons = { ...poolResult.failureReasons };

  for (const item of items) {
    if (!poolResult.succeeded.includes(item.mediaVersionId)) continue;
    // Already realized into single store (pool pruned) — treat as success.
    if (hasSdCachedMedia(item.mediaVersionId)) {
      succeeded.push(item.mediaVersionId);
      downloaded.push(item.mediaVersionId);
      continue;
    }
    const poolPath = getMediaPoolPath(item.mediaVersionId);
    if (!poolPath) {
      failed.push(item.mediaVersionId);
      failureReasons[item.mediaVersionId] = 'Pool path missing after fetch';
      continue;
    }
    if (!realizePoolPathToCache(item.mediaVersionId, item.fileUrl, poolPath)) {
      failed.push(item.mediaVersionId);
      failureReasons[item.mediaVersionId] =
        'Pool fetch ok but realize to perform6-media failed';
      continue;
    }
    succeeded.push(item.mediaVersionId);
    downloaded.push(item.mediaVersionId);
  }

  return {
    succeeded: [...new Set(succeeded)],
    downloaded: [...new Set(downloaded)],
    failed: [...new Set(failed)].filter((id) => !succeeded.includes(id)),
    failureReasons,
  };
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

  const capacityError = await assertCapacityForDownload(items);
  if (capacityError) {
    console.warn('[Perform6] Media download blocked — capacity', capacityError);
    return {
      succeeded: [],
      downloaded: [],
      failed: items.map((i) => i.mediaVersionId),
      failureReasons: Object.fromEntries(
        items.map((i) => [i.mediaVersionId, capacityError]),
      ),
    };
  }

  // Primary (BrightSign AssetPool): fetch → realize once into SD:/perform6-media/*.mp4
  // then prune pool staging (no dual forever-copy).
  // Fallback (Option B): autorun HTTP → same perform6-media dir (.part → rename).
  let result = isMediaAssetPoolAvailable()
    ? realizePoolBatchToCache(
        items,
        await downloadMediaItemsViaAssetPool(items, onProgress, options),
      )
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
      '[Perform6] Asset pool/realize incomplete — falling back to autorun perform6-media',
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
