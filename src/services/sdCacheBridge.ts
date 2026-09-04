import { runtimeConfig } from '../config/runtime';
import { getSharedMessagePort, subscribeBsMessages } from '../platform/bsMessagePort';
import {
  getNodeFs,
  rmTreeSync,
  toNodeSdPath,
} from '../platform/brightSignNode';
import type { SyncMediaItem } from '../shared/types/api';
import {
  estimateEtaSeconds,
  resetDownloadUiState,
  setDownloadUiState,
} from './downloadProgress';
import { labelForMediaVersionId, areTouchProgramsReady } from './touchProgramGate';
import { resolveMediaFileUrl } from './manifest';
import { cacheNameFor, sdCacheFileUrl } from './sdCacheName';
import { MEDIA_POOL_MARKS_VERSION } from './brightSignPoolPath';
import { listSdPath } from './sdFsBridge';

const PREFETCH_MESSAGE = 'led-cache-prefetch';
const KEEP_MESSAGE = 'led-cache-keep';
const EVICT_MESSAGE = 'led-cache-evict';
const CANCEL_MESSAGE = 'led-cache-cancel';
const PROGRESS_TYPE = 'led-cache-progress';
const READY_KEY = 'perform6-sd-cache-ready';
const CONFIRMED_KEY = 'perform6-sd-cache-confirmed';
/** mediaVersionId → asset-pool path from AssetPoolFiles.getPath */
const MEDIA_POOL_PATHS_KEY = 'perform6-media-pool-paths';
const MEDIA_POOL_PATHS_VERSION_KEY = 'perform6-media-pool-paths-ver';

function ensureMediaPoolMarksVersion(): void {
  try {
    const ver = localStorage.getItem(MEDIA_POOL_PATHS_VERSION_KEY);
    if (ver === MEDIA_POOL_MARKS_VERSION) return;
    localStorage.removeItem(MEDIA_POOL_PATHS_KEY);
    localStorage.setItem(MEDIA_POOL_PATHS_VERSION_KEY, MEDIA_POOL_MARKS_VERSION);
  } catch {
    /* ignore */
  }
}

/** Normalize URLs so autorun progress events match pending map keys. */
function normalizeCacheUrl(url: string): string {
  try {
    const parsed = new URL(resolveMediaFileUrl(url));
    parsed.hash = '';
    return parsed.href;
  } catch {
    return resolveMediaFileUrl(url).trim();
  }
}

/** One file per prefetch message — BrightSign cannot drain 8 HTTP transfers at once. */
export const PREFETCH_CHUNK_SIZE = 1;
/** Keep-set names only; larger batches are safe because no download starts. */
export const KEEP_CHUNK_SIZE = 12;

const MAX_DOWNLOAD_RETRIES = 3;
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
/** Bytes not growing this long → soft-cancel (keep .part) then retry. */
const DOWNLOAD_STALL_MS = 5 * 60_000;
/** No autorun start/progress ack at all → fail fast. */
const DOWNLOAD_START_ACK_MS = 60_000;
const MIN_FILE_TIMEOUT_MS = 10 * 60_000;
/** Large VOD (up to ~8GB) on gym Wi‑Fi — do not hard-kill while bytes still move. */
const MAX_FILE_TIMEOUT_MS = 8 * 60 * 60_000;
/** Assumed floor throughput for hard timeout (~100 KB/s). */
const TIMEOUT_BYTES_PER_SEC = 100_000;
/** Bulk lock must cover multi-GB downloads (one file at a time). */
const BULK_LOCK_MAX_MS = 8 * 60 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export type SdCacheProgressStatus = 'start' | 'progress' | 'done' | 'failed' | 'skip' | 'complete';

export interface SdCacheProgressEvent {
  type: typeof PROGRESS_TYPE;
  status: SdCacheProgressStatus;
  url?: string;
  name?: string;
  mediaVersionId?: string;
  error?: string;
  destPath?: string;
  bytesDownloaded?: number;
  bytesTotal?: number;
  doneCount?: number;
  totalCount?: number;
}

type ProgressListener = (event: SdCacheProgressEvent) => void;

const listeners = new Set<ProgressListener>();
let bulkDownloadInProgress = false;
let bulkDownloadStartedAtMs = 0;
let progressBridgeInstalled = false;

function parseProgressEvent(data: Record<string, unknown>): SdCacheProgressEvent | null {
  if (String(data.type ?? '') !== PROGRESS_TYPE) return null;
  return {
    type: PROGRESS_TYPE,
    status: String(data.status ?? '') as SdCacheProgressStatus,
    url: data.url != null ? String(data.url) : undefined,
    name: data.name != null ? String(data.name) : undefined,
    mediaVersionId:
      data.mediaVersionId != null ? String(data.mediaVersionId) : undefined,
    error: data.error != null ? String(data.error) : undefined,
    destPath: data.destPath != null ? String(data.destPath) : undefined,
    bytesDownloaded:
      data.bytesDownloaded != null ? Number(data.bytesDownloaded) : undefined,
    bytesTotal: data.bytesTotal != null ? Number(data.bytesTotal) : undefined,
    doneCount: data.doneCount != null ? Number(data.doneCount) : undefined,
    totalCount: data.totalCount != null ? Number(data.totalCount) : undefined,
  };
}

function dispatchProgress(event: SdCacheProgressEvent): void {
  for (const listener of listeners) listener(event);
}

/** Used by media asset pool to notify LED bridges of download completion. */
export function emitSdCacheProgress(event: Omit<SdCacheProgressEvent, 'type'> & { type?: string }): void {
  dispatchProgress({
    ...event,
    type: PROGRESS_TYPE,
    status: event.status,
  });
}

function ensureProgressBridge(): BrightSignMessagePort | null {
  const port = getSharedMessagePort();
  if (!port || progressBridgeInstalled) return port;
  progressBridgeInstalled = true;
  subscribeBsMessages((event) => {
    const payload = parseProgressEvent(event.data ?? {});
    if (payload) dispatchProgress(payload);
  });
  return port;
}

function getPort(): BrightSignMessagePort | null {
  return ensureProgressBridge();
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
  clearSdDownloadConfirmed(mediaVersionIds);
  clearMediaPoolPathMarks(mediaVersionIds);
}

function readMediaPoolPathMap(): Record<string, string> {
  ensureMediaPoolMarksVersion();
  try {
    const raw = localStorage.getItem(MEDIA_POOL_PATHS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeMediaPoolPathMap(map: Record<string, string>): void {
  localStorage.setItem(MEDIA_POOL_PATHS_KEY, JSON.stringify(map));
}

export function markMediaPoolPath(mediaVersionId: string, sdPath: string): void {
  const map = readMediaPoolPathMap();
  map[mediaVersionId] = sdPath;
  writeMediaPoolPathMap(map);
}

export function getMediaPoolPath(mediaVersionId: string): string | null {
  const path = readMediaPoolPathMap()[mediaVersionId];
  return path && path.length > 0 ? path : null;
}

export function clearMediaPoolPathMarks(mediaVersionIds?: string[]): void {
  if (!mediaVersionIds || mediaVersionIds.length === 0) {
    localStorage.removeItem(MEDIA_POOL_PATHS_KEY);
    return;
  }
  const map = readMediaPoolPathMap();
  for (const id of mediaVersionIds) delete map[id];
  writeMediaPoolPathMap(map);
}

function poolPathToFileUrl(sdPath: string): string {
  if (sdPath.startsWith('file://')) return sdPath;
  if (sdPath.startsWith('/storage/sd/')) {
    return `file:///SD:/${sdPath.slice('/storage/sd/'.length)}`;
  }
  if (sdPath.startsWith('SD:/') || sdPath.startsWith('sd:/')) {
    return `file:///${sdPath.replace(/^sd:/i, 'SD:')}`;
  }
  if (sdPath.startsWith('sd/')) {
    return `file:///SD:/${sdPath.slice(3)}`;
  }
  // Bare path from AssetPoolFiles (e.g. perform6-media-pool/ab/cd/…)
  if (sdPath.length > 0 && !sdPath.includes('://')) {
    const trimmed = sdPath.replace(/^\/+/, '');
    return `file:///SD:/${trimmed}`;
  }
  return sdPath;
}

function readConfirmedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(CONFIRMED_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(list);
  } catch {
    return new Set();
  }
}

function writeConfirmedSet(ids: Set<string>): void {
  localStorage.setItem(CONFIRMED_KEY, JSON.stringify([...ids]));
}

/** Set when autorun reports status=done (verified bytes on SD). */
export function markSdDownloadConfirmed(mediaVersionId: string): void {
  const ids = readConfirmedSet();
  ids.add(mediaVersionId);
  writeConfirmedSet(ids);
}

export function clearSdDownloadConfirmed(mediaVersionIds: string[]): void {
  if (mediaVersionIds.length === 0) return;
  const ids = readConfirmedSet();
  for (const id of mediaVersionIds) ids.delete(id);
  writeConfirmedSet(ids);
}

export function getConfirmedCachedMediaVersionIds(): string[] {
  return [...readConfirmedSet()];
}

export function clearAllSdCachedMarks(): void {
  localStorage.removeItem(READY_KEY);
  localStorage.removeItem(CONFIRMED_KEY);
  clearMediaPoolPathMarks();
}

export function getSdCachedUrl(mediaVersionId: string): string | null {
  return readReadyMap()[mediaVersionId] ?? null;
}

export function hasSdCachedMedia(mediaVersionId: string): boolean {
  return Boolean(getSdCachedUrl(mediaVersionId) || getMediaPoolPath(mediaVersionId));
}

/** True when autorun/pool confirmed the file on SD — safe to skip re-download / play. */
export function isMediaConfirmedOnSd(mediaVersionId: string): boolean {
  if (getMediaPoolPath(mediaVersionId)) return true;
  return (
    readConfirmedSet().has(mediaVersionId) && hasSdCachedMedia(mediaVersionId)
  );
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
  if (!bulkDownloadInProgress) return false;
  if (
    bulkDownloadStartedAtMs > 0 &&
    Date.now() - bulkDownloadStartedAtMs > BULK_LOCK_MAX_MS
  ) {
    console.warn(
      '[Perform6] SD bulk download lock expired — clearing stuck flag',
      { ageMs: Date.now() - bulkDownloadStartedAtMs },
    );
    bulkDownloadInProgress = false;
    bulkDownloadStartedAtMs = 0;
    return false;
  }
  return true;
}

/** Force-clear stuck media download lock (periodic sync self-heal). */
export function forceClearSdBulkDownloadLock(reason: string): void {
  if (!bulkDownloadInProgress) return;
  console.warn('[Perform6] SD bulk download lock force-cleared', reason);
  bulkDownloadInProgress = false;
  bulkDownloadStartedAtMs = 0;
}

/**
 * Reconcile localStorage marks against real SD:/perform6-cache listing.
 * Restores confirmed marks when files still exist; drops stale marks.
 */
export async function reconcileSdCacheMarksFromDisk(): Promise<{
  restored: number;
  dropped: number;
}> {
  if (runtimeConfig.isSimulator) return { restored: 0, dropped: 0 };

  const listing = await listSdPath('SD:/perform6-cache', 12_000);
  if (!listing.ok) {
    console.warn('[Perform6] SD cache reconcile skipped', listing.error);
    return { restored: 0, dropped: 0 };
  }

  const onDisk = new Map<string, number>();
  for (const entry of listing.entries) {
    if (entry.kind !== 'file') continue;
    if (entry.name.endsWith('.part')) continue;
    onDisk.set(entry.name, entry.size);
  }

  const ready = readReadyMap();
  let restored = 0;
  let dropped = 0;

  for (const [mediaVersionId, fileUrl] of Object.entries(ready)) {
    const name = cacheNameFor(resolveMediaFileUrl(fileUrl));
    const size = onDisk.get(name) ?? 0;
    if (size >= 1024) {
      markSdDownloadConfirmed(mediaVersionId);
      restored += 1;
    } else {
      clearSdCached([mediaVersionId]);
      clearSdDownloadConfirmed([mediaVersionId]);
      dropped += 1;
    }
  }

  if (restored > 0 || dropped > 0) {
    console.info('[Perform6] SD cache reconcile', {
      filesOnSd: onDisk.size,
      restored,
      dropped,
    });
  }
  return { restored, dropped };
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

function reconcilePendingAlreadyOnSd(
  pending: Map<string, SyncMediaItem>,
  succeeded: string[],
  succeededSoFar: Set<string>,
): void {
  for (const [url, item] of [...pending.entries()]) {
    if (!isMediaConfirmedOnSd(item.mediaVersionId)) continue;
    pending.delete(url);
    if (!succeeded.includes(item.mediaVersionId)) {
      succeeded.push(item.mediaVersionId);
    }
    succeededSoFar.add(item.mediaVersionId);
  }
}

function failPendingItems(
  pending: Map<string, SyncMediaItem>,
  failed: string[],
  failureReasons: Record<string, string>,
  reason: string,
): void {
  for (const item of pending.values()) {
    if (!failed.includes(item.mediaVersionId)) {
      failed.push(item.mediaVersionId);
    }
    failureReasons[item.mediaVersionId] = reason;
  }
  pending.clear();
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type CacheBridgeItem = {
  mediaVersionId: string;
  fileUrl: string;
  fileSize?: string | number | null;
};

/**
 * Ask autorun to download URLs into SD:/perform6-cache (all hardware profiles).
 * ids[i] and sizes[i] align with urls[i] for progress reporting and validation.
 */
function collectHttpItems(
  items: CacheBridgeItem[],
): { urls: string[]; ids: string[]; sizes: string[] } {
  const urls: string[] = [];
  const ids: string[] = [];
  const sizes: string[] = [];
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
    sizes.push(item.fileSize != null && item.fileSize !== '' ? String(Number(item.fileSize)) : '');
  }
  return { urls, ids, sizes };
}

export function requestSdCachePrefetch(
  items: CacheBridgeItem[],
  options?: { append?: boolean; priority?: boolean },
): boolean {
  const port = getPort();
  if (!port) {
    console.warn('[Perform6] SD cache prefetch skipped — BSMessagePort missing');
    return false;
  }

  const { urls, ids, sizes } = collectHttpItems(items);
  if (urls.length === 0) return true;

  port.PostBSMessage({
    type: PREFETCH_MESSAGE,
    role: prefetchRole(),
    urls: urls.join('|'),
    ids: ids.join('|'),
    sizes: sizes.join('|'),
    count: String(urls.length),
    append: options?.append ? 'true' : 'false',
    priority: options?.priority ? 'true' : 'false',
  });
  console.info('[Perform6] SD cache prefetch requested', {
    count: urls.length,
    append: options?.append ?? false,
    priority: options?.priority ?? false,
  });
  return true;
}

/** Bump a clip to the front of the autorun queue (tap before P1 finished). */
export function requestPrioritySdCache(items: CacheBridgeItem[]): boolean {
  return requestSdCachePrefetch(items, { append: true, priority: true });
}

/** Rebuild keep-set + prune without starting downloads. */
export function requestSdCacheKeepSet(keepItems: CacheBridgeItem[]): boolean {
  const port = getPort();
  if (!port) return false;

  const { urls } = collectHttpItems(keepItems);
  if (urls.length === 0) return true;

  const chunks = chunkItems(urls, KEEP_CHUNK_SIZE);
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    port.PostBSMessage({
      type: KEEP_MESSAGE,
      role: prefetchRole(),
      urls: chunk.join('|'),
      count: String(chunk.length),
      append: index > 0 ? 'true' : 'false',
      prune: index === chunks.length - 1 ? 'true' : 'false',
    });
  }
  console.info('[Perform6] SD cache keep-set', { count: urls.length });
  return true;
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

/** Cancel active/queued SD cache transfers (stall / hard timeout). */
export function requestSdCacheCancel(
  fileUrls?: string[],
  options?: { keepPart?: boolean },
): boolean {
  const port = getPort();
  if (!port) return false;
  const urls = fileUrls
    ? [
        ...new Set(
          fileUrls
            .map((u) => resolveMediaFileUrl(u))
            .filter((u) => u.startsWith('http')),
        ),
      ]
    : [];
  port.PostBSMessage({
    type: CANCEL_MESSAGE,
    role: prefetchRole(),
    urls: urls.join('|'),
    count: String(urls.length),
    // Soft cancel keeps .part so Range resume can continue (professional download).
    keepPart: options?.keepPart === true ? 'true' : 'false',
  });
  console.info('[Perform6] SD cache cancel requested', {
    count: urls.length || 'all-active',
    keepPart: options?.keepPart === true,
  });
  return true;
}

/** Delete all files under SD:/perform6-cache and reset the prefetch queue. */
export function requestSdCacheClearAll(): boolean {
  const port = getPort();
  if (!port) return false;
  port.PostBSMessage({
    type: 'led-cache-clear-all',
    role: prefetchRole(),
  });
  console.info('[Perform6] SD cache clear-all requested');
  return true;
}

/**
 * Wipe media cache dirs via Node fs (no autorun).
 * Never touches perform6-ota-pool or package files.
 */
export function clearSdMediaCacheViaNode(): boolean {
  const fs = getNodeFs();
  if (!fs) {
    console.warn('[Perform6] Node SD media clear skipped — fs unavailable');
    return false;
  }
  const targets = [
    toNodeSdPath('SD:/perform6-cache'),
    toNodeSdPath('SD:/perform6-media-pool'),
  ];
  let total = 0;
  for (const dir of targets) {
    total += rmTreeSync(fs, dir);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {
      /* best-effort recreate empty dir */
    }
  }
  console.info('[Perform6] Node SD media cache wiped', {
    removed: total,
    paths: targets,
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
  if (mediaVersionId) {
    for (const [key, candidate] of pending) {
      if (candidate.mediaVersionId === mediaVersionId) {
        return { url: key, item: candidate };
      }
    }
  }
  if (url) {
    const normalized = normalizeCacheUrl(url);
    const item = pending.get(normalized);
    if (item) return { url: normalized, item };
    for (const [key, candidate] of pending) {
      if (normalizeCacheUrl(candidate.fileUrl) === normalized) {
        return { url: key, item: candidate };
      }
    }
  }
  return undefined;
}

function describeCacheError(error?: string): string {
  if (!error) return 'Download failed';
  const lower = error.toLowerCase();
  if (error.includes('404') || lower.includes('not found')) {
    return 'Video not found on server (404)';
  }
  if (error.includes('403') || lower.includes('forbidden')) {
    return 'Access denied (403)';
  }
  if (error.includes('410')) return 'Video removed from server (410)';
  if (lower.includes('sd card full')) {
    return 'SD card is full — free space and sync again';
  }
  if (lower.includes('stalled') || lower.includes('cancelled for retry')) {
    return 'Download stalled — will retry';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'Download timed out — will retry';
  }
  if (lower.includes('network error') || lower.includes('couldn')) {
    return 'Network error — check connection';
  }
  if (lower.includes('size mismatch')) return 'Incomplete download — retrying';
  if (lower.includes('cancelled')) return 'Download cancelled — will retry';
  return error;
}

function isPermanentCacheError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  if (error.includes('404') || error.includes('403') || error.includes('410')) return true;
  if (lower.includes('sd card full')) return true;
  if (lower.includes('401 unauthorized')) return true;
  return false;
}

function isRetryableCacheError(error?: string): boolean {
  if (!error) return true;
  if (isPermanentCacheError(error)) return false;
  return true;
}

function fileHardTimeoutMs(item: SyncMediaItem): number {
  const bytes = item.fileSize != null ? Number(item.fileSize) : 0;
  if (Number.isFinite(bytes) && bytes > 0) {
    const bySize = Math.ceil(bytes / TIMEOUT_BYTES_PER_SEC) * 1000;
    return Math.min(MAX_FILE_TIMEOUT_MS, Math.max(MIN_FILE_TIMEOUT_MS, bySize));
  }
  return 15 * 60_000;
}

function chunkTimeoutMs(items: SyncMediaItem[]): number {
  const sum = items.reduce((total, item) => total + fileHardTimeoutMs(item), 0);
  return Math.max(MIN_FILE_TIMEOUT_MS, sum);
}

function sdCachePathForItem(item: SyncMediaItem): string {
  return `SD:/perform6-cache/${cacheNameFor(item.fileUrl)}`;
}

function sumBatchBytesTotal(items: SyncMediaItem[]): number | null {
  let total = 0;
  let hasAny = false;
  for (const item of items) {
    if (item.fileSize != null && Number(item.fileSize) > 0) {
      total += Number(item.fileSize);
      hasAny = true;
    }
  }
  return hasAny ? total : null;
}

function sumCompletedBatchBytes(
  items: SyncMediaItem[],
  succeededIds: Set<string>,
  activeBytes = 0,
): number {
  let sum = activeBytes;
  for (const item of items) {
    if (!succeededIds.has(item.mediaVersionId) && !hasSdCachedMedia(item.mediaVersionId)) {
      continue;
    }
    if (item.fileSize != null && Number(item.fileSize) > 0) {
      sum += Number(item.fileSize);
    }
  }
  return sum;
}

function updateDownloadUiFromBatch(
  items: SyncMediaItem[],
  succeededIds: Set<string>,
  currentItem: SyncMediaItem | null,
  manifestLabelSource?: {
    manifest: import('../shared/types').PlaybackManifest | null;
    fileBytesDownloaded?: number;
    fileBytesTotal?: number | null;
    cachePath?: string | null;
  },
): void {
  const remainingBytes = items.reduce((sum, item) => {
    if (succeededIds.has(item.mediaVersionId) || hasSdCachedMedia(item.mediaVersionId)) {
      return sum;
    }
    return sum + (item.fileSize != null ? Number(item.fileSize) : 0);
  }, 0);

  const completedFiles = items.filter(
    (item) => succeededIds.has(item.mediaVersionId) || hasSdCachedMedia(item.mediaVersionId),
  ).length;

  const label = currentItem
    ? currentItem.title?.trim() ||
      labelForMediaVersionId(manifestLabelSource?.manifest ?? null, currentItem.mediaVersionId)
    : null;

  const fileBytesDownloaded = manifestLabelSource?.fileBytesDownloaded ?? 0;
  const fileBytesTotal =
    manifestLabelSource?.fileBytesTotal ??
    (currentItem?.fileSize != null ? Number(currentItem.fileSize) : null);
  const cachePath =
    manifestLabelSource?.cachePath ??
    (currentItem ? sdCachePathForItem(currentItem) : null);

  setDownloadUiState({
    phase: 'downloading',
    currentLabel: label,
    completedFiles,
    totalFiles: items.length,
    cachePath,
    fileBytesDownloaded,
    fileBytesTotal,
    batchBytesDownloaded: sumCompletedBatchBytes(items, succeededIds, fileBytesDownloaded),
    batchBytesTotal: sumBatchBytesTotal(items),
    etaSeconds: estimateEtaSeconds(remainingBytes),
    retryInSeconds: null,
    statusMessage: null,
  });
}

async function downloadMediaChunkToSd(
  items: SyncMediaItem[],
  onProgress?: (progress: SdDownloadProgress) => void | Promise<void>,
  options?: {
    append?: boolean;
    priority?: boolean;
    manifest?: import('../shared/types').PlaybackManifest | null;
    batchItems?: SyncMediaItem[];
    succeededSoFar?: Set<string>;
  },
): Promise<{
  succeeded: string[];
  downloaded: string[];
  failed: string[];
  failureReasons: Record<string, string>;
}> {
  const succeeded: string[] = [];
  const downloaded: string[] = [];
  const failed: string[] = [];
  const failureReasons: Record<string, string> = {};

  if (items.length === 0) {
    return { succeeded, downloaded, failed, failureReasons };
  }

  const pending = new Map<string, SyncMediaItem>();
  for (const item of items) {
    pending.set(normalizeCacheUrl(item.fileUrl), item);
  }

  const totalBytesHint = items.reduce(
    (sum, item) => sum + (item.fileSize != null ? Number(item.fileSize) : 0),
    0,
  );
  let completedBytes = 0;
  const batchItems = options?.batchItems ?? items;
  const succeededSoFar = options?.succeededSoFar ?? new Set<string>();
  let lastProgressAt = Date.now();
  let lastProgressBytes = 0;
  let sawStartAck = false;
  const chunkStartedAt = Date.now();

  await new Promise<void>((resolve) => {
    let settled = false;
    let completeRetried = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      const pendingUrls = [...pending.values()].map((item) => item.fileUrl);
      requestSdCacheCancel(pendingUrls, { keepPart: true });
      settled = true;
      window.clearInterval(stallInterval);
      unsubscribe();
      failPendingItems(
        pending,
        failed,
        failureReasons,
        'Download timed out — cancelled for retry',
      );
      setDownloadUiState({
        phase: 'retrying',
        statusMessage: 'Download timed out — cancelling and retrying',
        retryInSeconds: null,
      });
      console.warn('[Perform6] SD cache chunk timed out — cancelled', {
        pending: pendingUrls.length,
        chunkSize: items.length,
        timeoutMs: chunkTimeoutMs(items),
      });
      resolve();
    }, chunkTimeoutMs(items));

    const stallInterval = window.setInterval(() => {
      if (settled || pending.size === 0) return;
      const waited = Date.now() - (sawStartAck ? lastProgressAt : chunkStartedAt);
      const limit = sawStartAck ? DOWNLOAD_STALL_MS : DOWNLOAD_START_ACK_MS;
      if (waited < limit) return;
      const pendingUrls = [...pending.values()].map((item) => item.fileUrl);
      const reason = sawStartAck
        ? 'Download stalled — cancelled for retry'
        : 'Download never started (no autorun progress) — cancelled for retry';
      console.warn('[Perform6] SD cache download stalled — cancelling for retry', {
        pending: pending.size,
        stallMs: limit,
        sawStartAck,
        lastProgressBytes,
        urls: pendingUrls,
      });
      // Keep .part on mid-download stall so resume continues; wipe only if never started.
      requestSdCacheCancel(pendingUrls, { keepPart: sawStartAck });
      failPendingItems(pending, failed, failureReasons, reason);
      setDownloadUiState({
        phase: 'retrying',
        statusMessage: reason,
        retryInSeconds: null,
      });
      finish();
    }, 10_000);

    const touchProgress = (bytes: number) => {
      if (bytes > lastProgressBytes) {
        lastProgressBytes = bytes;
        lastProgressAt = Date.now();
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(stallInterval);
      unsubscribe();
      resolve();
    };

    const unsubscribe = subscribeSdCacheProgress((event) => {
      const resolvedUrl = event.url ? normalizeCacheUrl(event.url) : '';
      const match = findPendingItem(pending, resolvedUrl, event.mediaVersionId);
      const item = match?.item;
      const url = match?.url ?? resolvedUrl;

      if (event.status === 'start' && item) {
        sawStartAck = true;
        clearSdCached([item.mediaVersionId]);
        succeededSoFar.delete(item.mediaVersionId);
        const fileBytes = event.bytesDownloaded ?? 0;
        const fileTotal =
          event.bytesTotal && event.bytesTotal > 0
            ? event.bytesTotal
            : item.fileSize != null
              ? Number(item.fileSize)
              : null;
        const cachePath = event.destPath ?? sdCachePathForItem(item);
        // Begin the watchdog only once BrightSign has acknowledged the
        // transfer. A queued request may wait briefly before it actually starts.
        lastProgressAt = Date.now();
        lastProgressBytes = fileBytes;
        updateDownloadUiFromBatch(batchItems, succeededSoFar, item, {
          manifest: options?.manifest ?? null,
          fileBytesDownloaded: fileBytes,
          fileBytesTotal: fileTotal,
          cachePath,
        });
        void onProgress?.({
          mediaVersionId: item.mediaVersionId,
          bytesDownloaded: fileBytes,
          totalBytes: fileTotal ?? (totalBytesHint || null),
          status: 'start',
        });
        return;
      }

      if (event.status === 'progress' && item) {
        sawStartAck = true;
        const fileBytes = event.bytesDownloaded ?? 0;
        const fileTotal =
          event.bytesTotal && event.bytesTotal > 0
            ? event.bytesTotal
            : item.fileSize != null
              ? Number(item.fileSize)
              : null;
        const cachePath = event.destPath ?? sdCachePathForItem(item);
        touchProgress(fileBytes);
        updateDownloadUiFromBatch(batchItems, succeededSoFar, item, {
          manifest: options?.manifest ?? null,
          fileBytesDownloaded: fileBytes,
          fileBytesTotal: fileTotal,
          cachePath,
        });
        void onProgress?.({
          mediaVersionId: item.mediaVersionId,
          bytesDownloaded: fileBytes,
          totalBytes: fileTotal ?? (totalBytesHint || null),
          status: 'progress',
        });
        return;
      }

      if (event.status === 'skip' && item) {
        pending.delete(url);
        markSdCached(item.mediaVersionId, item.fileUrl);
        markSdDownloadConfirmed(item.mediaVersionId);
        succeeded.push(item.mediaVersionId);
        succeededSoFar.add(item.mediaVersionId);
        const size = item.fileSize != null ? Number(item.fileSize) : 0;
        completedBytes += size;
        updateDownloadUiFromBatch(batchItems, succeededSoFar, null, {
          manifest: options?.manifest ?? null,
        });
        void onProgress?.({
          mediaVersionId: item.mediaVersionId,
          bytesDownloaded: completedBytes,
          totalBytes: totalBytesHint || null,
          status: 'skip',
        });
        if (pending.size === 0) finish();
        return;
      }

      if (event.status === 'done' && item) {
        pending.delete(url);
        markSdCached(item.mediaVersionId, item.fileUrl);
        markSdDownloadConfirmed(item.mediaVersionId);
        succeeded.push(item.mediaVersionId);
        downloaded.push(item.mediaVersionId);
        succeededSoFar.add(item.mediaVersionId);
        const size = item.fileSize != null ? Number(item.fileSize) : 0;
        completedBytes += size;
        updateDownloadUiFromBatch(batchItems, succeededSoFar, null, {
          manifest: options?.manifest ?? null,
        });
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
        const reason = event.error ?? 'SD cache download failed';
        failureReasons[item.mediaVersionId] = reason;
        const permanent = isPermanentCacheError(reason);
        setDownloadUiState({
          phase: permanent ? 'error' : 'downloading',
          statusMessage: describeCacheError(reason),
          retryInSeconds: null,
        });
        updateDownloadUiFromBatch(batchItems, succeededSoFar, item, {
          manifest: options?.manifest ?? null,
        });
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
        queueMicrotask(() => {
          queueMicrotask(() => {
            if (settled) return;
            reconcilePendingAlreadyOnSd(pending, succeeded, succeededSoFar);
            if (pending.size === 0) {
              finish();
              return;
            }
            if (!completeRetried) {
              completeRetried = true;
              const pendingItems = [...pending.values()].filter(
                (entry) => !isMediaConfirmedOnSd(entry.mediaVersionId),
              );
              if (pendingItems.length === 0) {
                finish();
                return;
              }
              console.warn('[Perform6] SD cache complete with pending — one retry', {
                pending: pendingItems.length,
              });
              const pendingUrls = pendingItems.map((i) => i.fileUrl);
              const pendingIds = pendingItems.map((i) => i.mediaVersionId);
              requestSdCacheEvict(pendingUrls);
              clearSdCached(pendingIds);
              clearSdDownloadConfirmed(pendingIds);
              for (const entry of pendingItems) {
                succeededSoFar.delete(entry.mediaVersionId);
              }
              requestSdCachePrefetch(
                pendingItems.map((item) => ({
                  mediaVersionId: item.mediaVersionId,
                  fileUrl: item.fileUrl,
                  fileSize: item.fileSize,
                })),
                { append: true, priority: true },
              );
              return;
            }
            const stillPendingUrls = [...pending.values()].map((i) => i.fileUrl);
            requestSdCacheCancel(stillPendingUrls, { keepPart: true });
            failPendingItems(
              pending,
              failed,
              failureReasons,
              'Download incomplete — cancelled for retry',
            );
            finish();
          });
        });
      }
    });

    const ok = requestSdCachePrefetch(
      items.map((item) => ({
        mediaVersionId: item.mediaVersionId,
        fileUrl: item.fileUrl,
        fileSize: item.fileSize,
      })),
      { append: options?.append ?? true, priority: options?.priority },
    );
    if (!ok) {
      for (const item of items) {
        failed.push(item.mediaVersionId);
        failureReasons[item.mediaVersionId] = 'SD cache bridge unavailable';
      }
      finish();
    }
  });

  return { succeeded, downloaded, failed, failureReasons };
}

/**
 * Prefetch missing items to SD and resolve when the batch finishes.
 * Sends URLs in small chunks so BSMessagePort payloads stay within limits.
 */
export async function downloadMediaItemsToSd(
  items: SyncMediaItem[],
  onProgress?: (progress: SdDownloadProgress) => void | Promise<void>,
  options?: { manifest?: import('../shared/types').PlaybackManifest | null },
): Promise<{
  succeeded: string[];
  downloaded: string[];
  failed: string[];
  failureReasons: Record<string, string>;
}> {
  const succeeded: string[] = [];
  const downloaded: string[] = [];
  const failed: string[] = [];
  const failureReasons: Record<string, string> = {};

  if (items.length === 0) {
    return { succeeded, downloaded, failed, failureReasons };
  }

  if (!isSdCacheBridgeAvailable()) {
    for (const item of items) {
      failed.push(item.mediaVersionId);
      failureReasons[item.mediaVersionId] = 'SD cache bridge unavailable';
    }
    return { succeeded, downloaded, failed, failureReasons };
  }

  bulkDownloadInProgress = true;
  bulkDownloadStartedAtMs = Date.now();
  const succeededSoFar = new Set<string>();

  for (const item of items) {
    if (isMediaConfirmedOnSd(item.mediaVersionId)) {
      succeeded.push(item.mediaVersionId);
      succeededSoFar.add(item.mediaVersionId);
    }
  }

  const pendingItems = items.filter((item) => !isMediaConfirmedOnSd(item.mediaVersionId));

  if (pendingItems.length === 0) {
    bulkDownloadInProgress = false;
    bulkDownloadStartedAtMs = 0;
    return {
      succeeded: [...new Set(succeeded)],
      downloaded,
      failed,
      failureReasons,
    };
  }

  updateDownloadUiFromBatch(pendingItems, succeededSoFar, pendingItems[0] ?? null, {
    manifest: options?.manifest ?? null,
  });

  try {
    requestSdCacheKeepSet(
      items.map((item) => ({
        mediaVersionId: item.mediaVersionId,
        fileUrl: item.fileUrl,
      })),
    );
    const chunks = chunkItems(pendingItems, PREFETCH_CHUNK_SIZE);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      let result = await downloadMediaChunkToSd(chunk, onProgress, {
        append: true,
        priority: index === 0,
        manifest: options?.manifest ?? null,
        batchItems: items,
        succeededSoFar,
      });
      succeeded.push(...result.succeeded);
      downloaded.push(...result.downloaded);
      for (const id of result.succeeded) succeededSoFar.add(id);
      Object.assign(failureReasons, result.failureReasons);

      let retries = 0;
      while (result.failed.length > 0 && retries < MAX_DOWNLOAD_RETRIES) {
        const delayMs = RETRY_DELAYS_MS[retries] ?? 30_000;
        const attempt = retries + 1;
        const retryItems = chunk.filter(
          (item) =>
            result.failed.includes(item.mediaVersionId) &&
            isRetryableCacheError(result.failureReasons[item.mediaVersionId]),
        );
        if (retryItems.length === 0) break;

        for (const item of retryItems) {
          delete failureReasons[item.mediaVersionId];
        }

        for (let sec = Math.ceil(delayMs / 1000); sec > 0; sec -= 1) {
          setDownloadUiState({
            phase: 'retrying',
            currentLabel: retryItems[0]?.title?.trim() || labelForMediaVersionId(
              options?.manifest ?? null,
              retryItems[0].mediaVersionId,
            ),
            retryInSeconds: sec,
            statusMessage: `Retry ${attempt}/${MAX_DOWNLOAD_RETRIES} after stall or timeout`,
          });
          await sleep(1000);
        }

        result = await downloadMediaChunkToSd(retryItems, onProgress, {
          append: true,
          priority: true,
          manifest: options?.manifest ?? null,
          batchItems: items,
          succeededSoFar,
        });
        succeeded.push(...result.succeeded.filter((id) => !succeeded.includes(id)));
        downloaded.push(...result.downloaded.filter((id) => !downloaded.includes(id)));
        for (const id of result.succeeded) {
          succeededSoFar.add(id);
          delete failureReasons[id];
        }
        Object.assign(failureReasons, result.failureReasons);
        retries += 1;
      }

      failed.push(...result.failed.filter((id) => !succeeded.includes(id)));
      for (const id of result.failed) {
        if (succeeded.includes(id)) continue;
        const reason = failureReasons[id] ?? '';
        if (
          reason.includes('cancelled for retry') ||
          reason.includes('stalled') ||
          reason.toLowerCase().includes('timed out')
        ) {
          failureReasons[id] =
            `Download failed after ${MAX_DOWNLOAD_RETRIES} retries — check network or use Sync Now`;
        }
      }
    }
  } finally {
    bulkDownloadInProgress = false;
    bulkDownloadStartedAtMs = 0;
    const manifest = options?.manifest ?? null;
    const hasPermanentFailure = Object.values(failureReasons).some(isPermanentCacheError);
    const hasAnyFailure = Object.keys(failureReasons).length > 0;
    if (manifest && !areTouchProgramsReady(manifest)) {
      setDownloadUiState({
        phase: hasPermanentFailure ? 'error' : hasAnyFailure ? 'downloading' : 'waiting',
        retryInSeconds: null,
        currentLabel: null,
        statusMessage: hasPermanentFailure
          ? describeCacheError(Object.values(failureReasons).find(isPermanentCacheError))
          : hasAnyFailure
            ? 'Some videos failed — ready items can still play'
            : null,
      });
    } else if (!hasPermanentFailure) {
      resetDownloadUiState();
    }
  }

  return {
    succeeded: [...new Set(succeeded)],
    downloaded: [...new Set(downloaded)],
    failed: [...new Set(failed)].filter((id) => !succeeded.includes(id)),
    failureReasons,
  };
}

/**
 * Local playback URL only when we have confirmed the file on SD.
 * Prefers BrightSign media asset-pool path; falls back to perform6-cache.
 * Always returns a HtmlWidget-safe file:///SD:/… URL (autorun normalizes for
 * roVideoPlayer). Returns null while downloading — never HTTPS on device.
 */
export function resolveSdPlaybackUrl(
  mediaVersionId: string,
  fallbackFileUrl?: string | null,
): string | null {
  const poolPath = getMediaPoolPath(mediaVersionId);
  if (poolPath) {
    return poolPathToFileUrl(poolPath);
  }

  const cachedUrl = getSdCachedUrl(mediaVersionId);
  if (cachedUrl) return sdCacheFileUrl(cachedUrl);

  // Confirmed on SD but ready-map URL missing — derive perform6-cache path.
  if (fallbackFileUrl && isMediaConfirmedOnSd(mediaVersionId)) {
    return sdCacheFileUrl(fallbackFileUrl);
  }
  return null;
}

export function cacheFileNameForMedia(fileUrl: string): string {
  return cacheNameFor(resolveMediaFileUrl(fileUrl));
}
