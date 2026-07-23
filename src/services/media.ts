import type { SyncMediaItem } from '../shared/types/api';
import { indexedDbContentStore } from './contentStore/indexedDbContentStore';
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

const blobUrlCache = new Map<string, string>();

async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function resolveLocalPlaybackUrl(
  mediaVersionId: string,
): Promise<string | null> {
  if (blobUrlCache.has(mediaVersionId)) {
    return blobUrlCache.get(mediaVersionId)!;
  }

  const blob = await indexedDbContentStore.get(mediaVersionId);
  if (!blob) return null;

  const objectUrl = URL.createObjectURL(blob);
  blobUrlCache.set(mediaVersionId, objectUrl);
  return objectUrl;
}

/** True when IndexedDB actually holds the media blob (not just a cache_records claim). */
export async function hasLocalMediaBlob(mediaVersionId: string): Promise<boolean> {
  if (blobUrlCache.has(mediaVersionId)) return true;
  return indexedDbContentStore.has(mediaVersionId);
}

export function revokeLocalPlaybackUrl(mediaVersionId: string): void {
  const existing = blobUrlCache.get(mediaVersionId);
  if (existing) {
    URL.revokeObjectURL(existing);
    blobUrlCache.delete(mediaVersionId);
  }
}

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number | null;
}

export async function downloadMediaItem(
  item: SyncMediaItem,
  onProgress?: (progress: DownloadProgress) => void | Promise<void>,
): Promise<number> {
  const resolvedUrl = resolveMediaFileUrl(item.fileUrl);
  const response = await fetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }

  const totalHeader = response.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : item.fileSize ? Number(item.fileSize) : null;

  if (!response.body) {
    const blob = await response.blob();
    if (item.checksum) {
      const actual = await sha256Hex(blob);
      if (actual !== item.checksum.toLowerCase()) {
        throw new Error('Checksum verification failed');
      }
    }
    await indexedDbContentStore.put(item.mediaVersionId, blob, {
      checksum: item.checksum,
    });
    await offlineCacheService.storeMediaMeta({
      assetId: item.mediaVersionId,
      url: resolvedUrl,
      type: 'video',
      cachedAt: new Date().toISOString(),
      sizeBytes: blob.size,
      checksum: item.checksum,
    });
    await onProgress?.({ bytesDownloaded: blob.size, totalBytes: blob.size });
    return blob.size;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesDownloaded = 0;
  let lastReportedAt = 0;
  // Throttle progress reports to at most one every ~2s so a large file
  // doesn't flood the backend with hundreds of requests.
  const PROGRESS_MIN_INTERVAL_MS = 2000;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      bytesDownloaded += value.length;
      const now = Date.now();
      if (now - lastReportedAt >= PROGRESS_MIN_INTERVAL_MS) {
        lastReportedAt = now;
        await onProgress?.({ bytesDownloaded, totalBytes });
      }
    }
  }

  const blob = new Blob(chunks, { type: response.headers.get('content-type') ?? 'video/mp4' });

  if (item.checksum) {
    const actual = await sha256Hex(blob);
    if (actual !== item.checksum.toLowerCase()) {
      throw new Error('Checksum verification failed');
    }
  }

  await indexedDbContentStore.put(item.mediaVersionId, blob, {
    checksum: item.checksum,
  });

  await offlineCacheService.storeMediaMeta({
    assetId: item.mediaVersionId,
    url: resolvedUrl,
    type: 'video',
    cachedAt: new Date().toISOString(),
    sizeBytes: blob.size,
    checksum: item.checksum,
  });

  await onProgress?.({ bytesDownloaded: blob.size, totalBytes: totalBytes ?? blob.size });
  return blob.size;
}

export async function evictCachedMedia(mediaVersionIds: string[]): Promise<void> {
  if (mediaVersionIds.length === 0) return;
  for (const id of mediaVersionIds) {
    revokeLocalPlaybackUrl(id);
  }
  await indexedDbContentStore.deleteMany(mediaVersionIds);
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
