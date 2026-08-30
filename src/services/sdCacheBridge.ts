import { runtimeConfig } from '../config/runtime';
import type { SyncMediaItem } from '../shared/types/api';
import { resolveMediaFileUrl } from './manifest';
import { cacheNameFor, sdCacheFileUrl } from './sdCacheName';

const PREFETCH_MESSAGE = 'led-cache-prefetch';
const EVICT_MESSAGE = 'led-cache-evict';
const PROGRESS_TYPE = 'led-cache-progress';
const READY_KEY = 'perform6-sd-cache-ready';

/** URLs per BSMessagePort prefetch message (avoids payload truncation). */
export const PREFETCH_CHUNK_SIZE = 8;

export type SdCacheProgressStatus = 'start' | 'done' | 'failed' | 'skip' | 'complete';

export interface SdCacheProgressEvent {
  type: typeof PROGRESS_TYPE;
  status: SdCacheProgressStatus;
  url?: string;
  name?: string;
  mediaVersionId?: string;
  error?: string;
  doneCount?: number;
  totalCount?: number;
}

type ProgressListener = (event: SdCacheProgressEvent) => void;

let sharedPort: BrightSignMessagePort | null | undefined;
const listeners = new Set<ProgressListener>();
let bulkDownloadInProgress = false;

function createMessagePort(): BrightSignMessagePort | null {
  try {
    const ctor = window.BSMessagePort;
    return typeof ctor === 'function' ? new ctor() : null;
  } catch {
    return null;
  }
}

function getPort(): BrightSignMessagePort | null {
  if (sharedPort !== undefined) return sharedPort;
  sharedPort = createMessagePort();
  if (sharedPort) {
    sharedPort.addEventListener('bsmessage', (event) => {
      const data = event.data ?? {};
      if (String(data.type ?? '') !== PROGRESS_TYPE) return;
      const payload: SdCacheProgressEvent = {
        type: PROGRESS_TYPE,
        status: String(data.status ?? '') as SdCacheProgressStatus,
        url: data.url != null ? String(data.url) : undefined,
        name: data.name != null ? String(data.name) : undefined,
        mediaVersionId:
          data.mediaVersionId != null ? String(data.mediaVersionId) : undefined,
        error: data.error != null ? String(data.error) : undefined,
        doneCount:
          data.doneCount != null ? Number(data.doneCount) : undefined,
        totalCount:
          data.totalCount != null ? Number(data.totalCount) : undefined,
      };
      for (const listener of listeners) listener(payload);
    });
  }
  return sharedPort;
}

function readReadyMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(READY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeReadyMap(map: Record<string, string>): void {
  localStorage.setItem(READY_KEY, JSON.stringify(map));
}

/** mediaVersionId → HTTPS url we last confirmed on SD. */
export function markSdCached(mediaVersionId: string, fileUrl: string): void {
  const map = readReadyMap();
  map[mediaVersionId] = resolveMediaFileUrl(fileUrl);
  writeReadyMap(map);
}

export function clearSdCached(mediaVersionIds: string[]): void {
  if (mediaVersionIds.length === 0) return;
  const map = readReadyMap();
  for (const id of mediaVersionIds) delete map[id];
  writeReadyMap(map);
}

export function clearAllSdCachedMarks(): void {
  localStorage.removeItem(READY_KEY);
}

export function getSdCachedUrl(mediaVersionId: string): string | null {
  return readReadyMap()[mediaVersionId] ?? null;
}

export function hasSdCachedMedia(mediaVersionId: string): boolean {
  return Boolean(getSdCachedUrl(mediaVersionId));
}

export function listSdCachedMediaVersionIds(): string[] {
  return Object.keys(readReadyMap());
}

export function isSdCacheBridgeAvailable(): boolean {
  if (runtimeConfig.isSimulator) return false;
  return getPort() != null;
}

/** True while a multi-file SD download batch is running (blocks interval sync). */
export function isSdBulkDownloadInProgress(): boolean {
  return bulkDownloadInProgress;
}

function prefetchRole(): string {
  if (runtimeConfig.hardwareProfile === 'XC4055') return 'primary';
  if (runtimeConfig.hardwareProfile === 'XT2145') return 'touch';
  return 'primary';
}

export function subscribeSdCacheProgress(listener: ProgressListener): () => void {
  getPort();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Ask autorun to download URLs into SD:/perform6-cache (all hardware profiles).
 * ids[i] aligns with urls[i] for progress reporting.
 */
export function requestSdCachePrefetch(
  items: Array<{ mediaVersionId: string; fileUrl: string }>,
  options?: { append?: boolean },
): boolean {
  const port = getPort();
  if (!port) {
    console.warn('[Perform6] SD cache prefetch skipped — BSMessagePort missing');
    return false;
  }

  const urls: string[] = [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const resolved = resolveMediaFileUrl(item.fileUrl);
    if (!resolved.startsWith('http://') && !resolved.startsWith('https://')) {
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    urls.push(resolved);
    ids.push(item.mediaVersionId);
  }
  if (urls.length === 0) return true;

  port.PostBSMessage({
    type: PREFETCH_MESSAGE,
    role: prefetchRole(),
    urls: urls.join('|'),
    ids: ids.join('|'),
    count: String(urls.length),
    append: options?.append ? 'true' : 'false',
  });
  console.info('[Perform6] SD cache prefetch requested', {
    count: urls.length,
    append: options?.append ?? false,
  });
  return true;
}

/** Rebuild keep-set + prune (same rotation eviction as before, on SD). */
export function requestSdCacheKeepSet(
  keepItems: Array<{ mediaVersionId: string; fileUrl: string }>,
): boolean {
  return requestSdCachePrefetch(keepItems);
}

export function requestSdCacheEvict(fileUrls: string[]): boolean {
  const port = getPort();
  if (!port) return false;
  const urls = [
    ...new Set(
      fileUrls
        .map((u) => resolveMediaFileUrl(u))
        .filter((u) => u.startsWith('http')),
    ),
  ];
  if (urls.length === 0) return true;
  port.PostBSMessage({
    type: EVICT_MESSAGE,
    role: prefetchRole(),
    urls: urls.join('|'),
    count: String(urls.length),
  });
  return true;
}

export interface SdDownloadProgress {
  bytesDownloaded: number;
  totalBytes: number | null;
  mediaVersionId: string;
  status: SdCacheProgressStatus;
}

function findPendingItem(
  pending: Map<string, SyncMediaItem>,
  url: string,
  mediaVersionId?: string,
): { url: string; item: SyncMediaItem } | undefined {
  if (url) {
    const item = pending.get(url);
    if (item) return { url, item };
  }
  if (mediaVersionId) {
    for (const [key, candidate] of pending) {
      if (candidate.mediaVersionId === mediaVersionId) {
        return { url: key, item: candidate };
      }
    }
  }
  return undefined;
}

function chunkTimeoutMs(items: SyncMediaItem[]): number {
  const perFileMs = items.map((item) => {
    const bytes = item.fileSize != null ? Number(item.fileSize) : 0;
    if (bytes > 0) {
      // ~400 KB/s effective + 10 min floor per large file.
      return Math.max(600_000, Math.ceil(bytes / 400_000) * 1000);
    }
    return 900_000;
  });
  const sum = perFileMs.reduce((a, b) => a + b, 0);
  return Math.max(300_000, sum);
}

async function downloadMediaChunkToSd(
  items: SyncMediaItem[],
  onProgress?: (progress: SdDownloadProgress) => void | Promise<void>,
  options?: { append?: boolean },
): Promise<{ succeeded: string[]; failed: string[] }> {
  const succeeded: string[] = [];
  const failed: string[] = [];

  if (items.length === 0) {
    return { succeeded, failed };
  }

  const pending = new Map<string, SyncMediaItem>();
  for (const item of items) {
    pending.set(resolveMediaFileUrl(item.fileUrl), item);
  }

  const totalBytesHint = items.reduce(
    (sum, item) => sum + (item.fileSize != null ? Number(item.fileSize) : 0),
    0,
  );
  let completedBytes = 0;

  await new Promise<void>((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      for (const item of pending.values()) failed.push(item.mediaVersionId);
      console.warn('[Perform6] SD cache chunk timed out', {
        pending: pending.size,
        chunkSize: items.length,
      });
      resolve();
    }, chunkTimeoutMs(items));

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve();
    };

    const unsubscribe = subscribeSdCacheProgress((event) => {
      const resolvedUrl = event.url ? resolveMediaFileUrl(event.url) : '';
      const match = findPendingItem(pending, resolvedUrl, event.mediaVersionId);
      const item = match?.item;
      const url = match?.url ?? resolvedUrl;

      if (event.status === 'start' && item) {
        void onProgress?.({
          mediaVersionId: item.mediaVersionId,
          bytesDownloaded: completedBytes,
          totalBytes: totalBytesHint || null,
          status: 'start',
        });
        return;
      }

      if ((event.status === 'done' || event.status === 'skip') && item) {
        pending.delete(url);
        markSdCached(item.mediaVersionId, item.fileUrl);
        succeeded.push(item.mediaVersionId);
        const size = item.fileSize != null ? Number(item.fileSize) : 0;
        completedBytes += size;
        void onProgress?.({
          mediaVersionId: item.mediaVersionId,
          bytesDownloaded: completedBytes,
          totalBytes: totalBytesHint || null,
          status: event.status,
        });
        if (pending.size === 0) finish();
        return;
      }

      if (event.status === 'failed' && item) {
        pending.delete(url);
        failed.push(item.mediaVersionId);
        void onProgress?.({
          mediaVersionId: item.mediaVersionId,
          bytesDownloaded: completedBytes,
          totalBytes: totalBytesHint || null,
          status: 'failed',
        });
        if (pending.size === 0) finish();
        return;
      }

      if (event.status === 'complete') {
        // Autorun finished this chunk's queue — only resolve when all items accounted for.
        if (pending.size === 0) {
          finish();
        } else {
          console.warn('[Perform6] SD cache complete with pending items — waiting', {
            pending: pending.size,
          });
        }
      }
    });

    const ok = requestSdCachePrefetch(
      items.map((item) => ({
        mediaVersionId: item.mediaVersionId,
        fileUrl: item.fileUrl,
      })),
      { append: options?.append },
    );
    if (!ok) {
      for (const item of items) failed.push(item.mediaVersionId);
      finish();
    }
  });

  return { succeeded, failed };
}

/**
 * Prefetch missing items to SD and resolve when the batch finishes.
 * Sends URLs in small chunks so BSMessagePort payloads stay within limits.
 */
export async function downloadMediaItemsToSd(
  items: SyncMediaItem[],
  onProgress?: (progress: SdDownloadProgress) => void | Promise<void>,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const succeeded: string[] = [];
  const failed: string[] = [];

  if (items.length === 0) {
    return { succeeded, failed };
  }

  if (!isSdCacheBridgeAvailable()) {
    for (const item of items) failed.push(item.mediaVersionId);
    return { succeeded, failed };
  }

  bulkDownloadInProgress = true;
  try {
    const chunks = chunkItems(items, PREFETCH_CHUNK_SIZE);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const result = await downloadMediaChunkToSd(chunk, onProgress, {
        append: index > 0,
      });
      succeeded.push(...result.succeeded);
      failed.push(...result.failed);
    }
  } finally {
    bulkDownloadInProgress = false;
  }

  return { succeeded, failed };
}

/**
 * Local playback URL only when we have confirmed the file on SD.
 * Returns null while downloading so callers can fall back to HTTPS.
 */
export function resolveSdPlaybackUrl(
  mediaVersionId: string,
  _fallbackFileUrl?: string | null,
): string | null {
  const cachedUrl = getSdCachedUrl(mediaVersionId);
  if (cachedUrl) return sdCacheFileUrl(cachedUrl);
  return null;
}

export function cacheFileNameForMedia(fileUrl: string): string {
  return cacheNameFor(resolveMediaFileUrl(fileUrl));
}
