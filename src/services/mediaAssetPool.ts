/**
 * BrightSign asset-pool media delivery (separate from OTA).
 * Pool dir: /storage/sd/perform6-media-pool (OS 9.1); docs fallback sd/….
 * Autorun wipe still targets SD:/perform6-media-pool.
 * On pool failure/stall → media.ts falls back to autorun SD:/perform6-cache.
 */
import type { SyncMediaItem } from '../shared/types/api';
import { resolveMediaFileUrl } from './manifest';
import { cacheNameFor } from './sdCacheName';
import {
  MEDIA_ASSET_POOL_DIR,
  MEDIA_ASSET_POOL_DIR_DOCS,
} from './brightSignPoolPath';
import {
  clearSdCached,
  getMediaPoolPath,
  markMediaPoolPath,
  markSdCached,
  markSdDownloadConfirmed,
  clearMediaPoolPathMarks,
  emitSdCacheProgress,
  type SdDownloadProgress,
} from './sdCacheBridge';
import {
  estimateEtaSeconds,
  resetDownloadUiState,
  setDownloadUiState,
} from './downloadProgress';
import { labelForMediaVersionId } from './touchProgramGate';
import { probeBrightSignAssetPool } from './assetPoolProbe';

/** AssetPool constructor path (/storage/sd/perform6-media-pool on OS 9.1). */
export const MEDIA_POOL_PATH = MEDIA_ASSET_POOL_DIR;

/**
 * No progressevent/fileevent after start → abort fast so media.ts can fall
 * back to autorun perform6-cache (BrightSign-docs path must not hang forever).
 */
const POOL_START_MS = 60_000;
/**
 * Mid-download: no byte progress / fileevent for this long → abort.
 * Timer resets on real progress. Longer than before so slow gym links can finish.
 */
const POOL_STALL_MS = 5 * 60_000;
/** Absolute max for downloadInProgress flag — must cover multi-GB VOD. */
const POOL_LOCK_MAX_MS = 8 * 60 * 60_000;

type BrightSignRequire = (id: string) => unknown;

type AssetHash = { method: string; hex: string };

export type MediaAsset = {
  name: string;
  link: string;
  size?: number;
  hash?: AssetHash;
  changeHint?: string;
  changehint?: string;
};

type AssetPoolInstance = {
  protectAssets: (name: string, list: MediaAsset[]) => Promise<void> | void;
};

type ProgressEvent = {
  type?: string;
  filename?: string;
  index?: number;
  total?: number;
  currentFileTransferred?: number;
  currentFileTotal?: number;
};

type FileEvent = {
  type?: string;
  filename?: string;
  index?: number;
  responseCode?: number;
  error?: string;
};

type AssetPoolFetcherInstance = {
  start: (list: MediaAsset[], params?: Record<string, unknown>) => Promise<void>;
  cancel: () => Promise<void>;
  addEventListener: (
    type: string,
    handler: (event: ProgressEvent | FileEvent) => void,
  ) => void;
  removeEventListener?: (
    type: string,
    handler: (event: ProgressEvent | FileEvent) => void,
  ) => void;
};

type AssetPoolFilesInstance = {
  getPath: (name: string) => Promise<string> | string;
};

type AssetPoolCtor = new (path: string) => AssetPoolInstance;
type AssetPoolFetcherCtor = new (pool: AssetPoolInstance) => AssetPoolFetcherInstance;
type AssetPoolFilesCtor = new (
  pool: AssetPoolInstance,
  list: MediaAsset[],
) => AssetPoolFilesInstance;

let pool: AssetPoolInstance | null = null;
let fetcher: AssetPoolFetcherInstance | null = null;
let FetcherClassRef: AssetPoolFetcherCtor | null = null;
let activeFetch: AssetPoolFetcherInstance | null = null;
let modulesLoaded = false;
let modulesAvailable = false;
let AssetPoolFilesClass: AssetPoolFilesCtor | null = null;
let downloadInProgress = false;
let downloadStartedAtMs = 0;
/** Active listener pair — removed before each new fetch to avoid MaxListeners leaks. */
let boundFileListener: ((event: FileEvent) => void) | null = null;
let boundProgressListener: ((event: ProgressEvent) => void) | null = null;

function detachFetcherListeners(target: AssetPoolFetcherInstance | null): void {
  if (!target) return;
  if (boundFileListener && typeof target.removeEventListener === 'function') {
    try {
      target.removeEventListener('fileevent', boundFileListener);
    } catch {
      /* ignore */
    }
  }
  if (boundProgressListener && typeof target.removeEventListener === 'function') {
    try {
      target.removeEventListener('progressevent', boundProgressListener);
    } catch {
      /* ignore */
    }
  }
  boundFileListener = null;
  boundProgressListener = null;
}

/** Fresh fetcher per download when removeEventListener is missing (OS EventEmitter leak). */
function recreateFetcher(): AssetPoolFetcherInstance | null {
  if (!pool || !FetcherClassRef) return fetcher;
  detachFetcherListeners(fetcher);
  try {
    fetcher = new FetcherClassRef(pool);
    return fetcher;
  } catch (e) {
    console.warn(
      '[Perform6] Media asset pool fetcher recreate failed',
      e instanceof Error ? e.message : e,
    );
    return fetcher;
  }
}

function getRequire(): BrightSignRequire | null {
  const g = globalThis as { require?: BrightSignRequire };
  if (typeof g.require === 'function') return g.require;
  if (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { require?: BrightSignRequire }).require === 'function'
  ) {
    return (window as unknown as { require: BrightSignRequire }).require;
  }
  return null;
}

function loadModules(): boolean {
  if (modulesAvailable && pool && fetcher) return true;
  if (modulesLoaded && !modulesAvailable) return false;

  const probe = probeBrightSignAssetPool();
  if (!probe.assetpool || !probe.assetpoolfetcher) {
    modulesLoaded = true;
    modulesAvailable = false;
    console.info('[Perform6] Media asset pool unavailable', probe);
    return false;
  }

  const req = getRequire();
  if (!req) {
    modulesLoaded = true;
    modulesAvailable = false;
    return false;
  }

  // XT2145 / OS 9.1: /storage/sd/… works. Docs `sd/…` fallback only.
  // Never probe SD: or sd:/ — those become "/SD:" / "/sd:/…" and spam the log.
  const pathCandidates = [MEDIA_POOL_PATH, MEDIA_ASSET_POOL_DIR_DOCS];

  try {
    const PoolClass = req('@brightsign/assetpool') as AssetPoolCtor;
    const FetcherClass = req('@brightsign/assetpoolfetcher') as AssetPoolFetcherCtor;
    FetcherClassRef = FetcherClass;

    let lastErr: unknown = null;
    for (const path of pathCandidates) {
      try {
        pool = new PoolClass(path);
        fetcher = new FetcherClass(pool);
        console.info('[Perform6] Media asset pool ready', { path });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        pool = null;
        fetcher = null;
        console.warn(
          '[Perform6] Media asset pool path failed',
          path,
          e instanceof Error ? e.message : e,
        );
      }
    }

    if (!pool || !fetcher) {
      // Folder may not exist yet — allow retry after autorun CreateDirectory.
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? '');
      if (/not accessible|not found|no such/i.test(msg)) {
        modulesLoaded = false;
        modulesAvailable = false;
        console.warn(
          '[Perform6] Media asset pool init deferred (dir missing?) — will retry',
          msg,
        );
        return false;
      }
      throw lastErr instanceof Error
        ? lastErr
        : new Error('Media asset pool unavailable (all paths failed)');
    }

    try {
      AssetPoolFilesClass = req('@brightsign/assetpoolfiles') as AssetPoolFilesCtor;
    } catch {
      try {
        AssetPoolFilesClass = req('@brightsign/assetfiles') as AssetPoolFilesCtor;
      } catch {
        AssetPoolFilesClass = null;
      }
    }

    modulesLoaded = true;
    modulesAvailable = true;
  } catch (e) {
    modulesLoaded = true;
    modulesAvailable = false;
    pool = null;
    fetcher = null;
    console.warn(
      '[Perform6] Media asset pool init failed',
      e instanceof Error ? e.message : e,
    );
  }

  return modulesAvailable;
}

export function isMediaAssetPoolAvailable(): boolean {
  return loadModules();
}

export function isMediaAssetPoolDownloadInProgress(): boolean {
  if (!downloadInProgress) return false;
  if (
    downloadStartedAtMs > 0 &&
    Date.now() - downloadStartedAtMs > POOL_LOCK_MAX_MS
  ) {
    console.warn(
      '[Perform6] Media asset pool lock expired — clearing stuck flag',
      { ageMs: Date.now() - downloadStartedAtMs },
    );
    downloadInProgress = false;
    downloadStartedAtMs = 0;
    return false;
  }
  return true;
}

export function forceClearMediaAssetPoolLock(reason: string): void {
  if (!downloadInProgress) return;
  console.warn('[Perform6] Media asset pool lock force-cleared', reason);
  downloadInProgress = false;
  downloadStartedAtMs = 0;
}

export function getMediaPoolPlaybackPath(mediaVersionId: string): string | null {
  return getMediaPoolPath(mediaVersionId);
}

export function clearMediaPoolPlaybackPaths(mediaVersionIds?: string[]): void {
  clearMediaPoolPathMarks(mediaVersionIds);
}

function toFileUrl(sdPath: string): string {
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
  if (sdPath.length > 0 && !sdPath.includes('://')) {
    return `file:///SD:/${sdPath.replace(/^\/+/, '')}`;
  }
  return sdPath;
}

function parseAssetHash(checksum?: string): AssetHash | undefined {
  if (!checksum) return undefined;
  const hex = checksum.trim().toLowerCase().replace(/^sha-?(1|256|512):/i, '');
  if (/^[a-f0-9]{64}$/.test(hex)) return { method: 'sha256', hex };
  if (/^[a-f0-9]{40}$/.test(hex)) return { method: 'sha1', hex };
  if (/^[a-f0-9]{128}$/.test(hex)) return { method: 'sha512', hex };
  return undefined;
}

export function mediaItemToAsset(item: SyncMediaItem): MediaAsset {
  const link = resolveMediaFileUrl(item.fileUrl);
  const name = cacheNameFor(link);
  const size =
    item.fileSize != null && Number(item.fileSize) > 0
      ? Number(item.fileSize)
      : undefined;
  const hash = parseAssetHash(item.checksum);
  const asset: MediaAsset = { name, link };
  if (size != null) asset.size = size;
  if (hash) asset.hash = hash;
  else {
    asset.changehint = item.mediaVersionId;
    asset.changeHint = item.mediaVersionId;
  }
  return asset;
}

async function resolvePoolPath(
  assetList: MediaAsset[],
  assetName: string,
): Promise<string | null> {
  if (!pool || !AssetPoolFilesClass) return null;
  try {
    const files = new AssetPoolFilesClass(pool, assetList);
    const path = await Promise.resolve(files.getPath(assetName));
    return path && String(path).length > 0 ? String(path) : null;
  } catch {
    return null;
  }
}

export async function cancelMediaAssetPoolFetch(): Promise<void> {
  const target = activeFetch ?? fetcher;
  if (!target) return;
  try {
    await target.cancel();
  } catch {
    /* already idle */
  }
}

/**
 * Fetch media into SD:/perform6-media-pool via BrightSign AssetPoolFetcher.
 * Does not touch OTA paths or autorun OTA workers.
 */
export async function downloadMediaItemsViaAssetPool(
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

  if (!isMediaAssetPoolAvailable() || !pool || !fetcher) {
    for (const item of items) {
      failed.push(item.mediaVersionId);
      failureReasons[item.mediaVersionId] = 'Media asset pool unavailable';
    }
    return { succeeded, downloaded, failed, failureReasons };
  }

  const byName = new Map<string, SyncMediaItem>();
  const assetList: MediaAsset[] = [];
  for (const item of items) {
    const asset = mediaItemToAsset(item);
    byName.set(asset.name, item);
    assetList.push(asset);
  }

  const already: SyncMediaItem[] = [];
  const needFetch: MediaAsset[] = [];

  // Only skip when AssetPoolFiles resolves a real path (not stale localStorage).
  for (const asset of assetList) {
    const item = byName.get(asset.name)!;
    const marked = getMediaPoolPath(item.mediaVersionId);
    if (marked) {
      const verified = await resolvePoolPath(assetList, asset.name);
      if (verified) {
        markMediaPoolPath(item.mediaVersionId, verified);
        already.push(item);
        succeeded.push(item.mediaVersionId);
        continue;
      }
      clearMediaPoolPathMarks([item.mediaVersionId]);
      clearSdCached([item.mediaVersionId]);
    }
    needFetch.push(asset);
  }

  if (already.length === items.length) {
    resetDownloadUiState();
    return { succeeded, downloaded, failed, failureReasons };
  }

  downloadInProgress = true;
  downloadStartedAtMs = Date.now();
  const runFetcher = recreateFetcher() ?? fetcher;
  if (!runFetcher) {
    for (const item of items) {
      failed.push(item.mediaVersionId);
      failureReasons[item.mediaVersionId] = 'Media asset pool fetcher unavailable';
    }
    downloadInProgress = false;
    downloadStartedAtMs = 0;
    return { succeeded, downloaded, failed, failureReasons };
  }
  activeFetch = runFetcher;

  const batchBytesTotal = items.reduce((sum, item) => {
    const n = item.fileSize != null ? Number(item.fileSize) : 0;
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);

  let completedFiles = already.length;
  let batchBytesDownloaded = already.reduce((sum, item) => {
    const n = item.fileSize != null ? Number(item.fileSize) : 0;
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);

  const updateUi = (
    current: SyncMediaItem | null,
    fileBytesDownloaded: number,
    fileBytesTotal: number | null,
    cachePath: string | null,
  ) => {
    const remaining = Math.max(0, batchBytesTotal - batchBytesDownloaded);
    setDownloadUiState({
      phase: 'downloading',
      currentLabel: current
        ? current.title?.trim() ||
          labelForMediaVersionId(options?.manifest ?? null, current.mediaVersionId)
        : null,
      completedFiles,
      totalFiles: items.length,
      cachePath,
      fileBytesDownloaded,
      fileBytesTotal,
      batchBytesDownloaded,
      batchBytesTotal: batchBytesTotal || null,
      etaSeconds: estimateEtaSeconds(remaining),
      retryInSeconds: null,
      statusMessage: null,
    });
  };

  const firstNeed = byName.get(needFetch[0]?.name ?? '') ?? null;
  // Local UI only — do NOT report 0-byte progress to Admin (false DOWNLOADING).
  updateUi(
    firstNeed,
    0,
    firstNeed?.fileSize != null ? Number(firstNeed.fileSize) : null,
    MEDIA_POOL_PATH,
  );

  // Start watchdog (45s, no events) then stall watchdog (5m quiet mid-download).
  let stallTimer: number | undefined;
  let stallReject: ((err: Error) => void) | null = null;
  let lastProgressBytes = 0;
  let lastProgressFile = '';
  let sawPoolActivity = false;

  const clearStallTimer = () => {
    if (stallTimer != null) {
      window.clearTimeout(stallTimer);
      stallTimer = undefined;
    }
  };

  const armWatchdog = (ms: number, message: string) => {
    clearStallTimer();
    stallTimer = window.setTimeout(() => {
      void cancelMediaAssetPoolFetch();
      stallReject?.(new Error(message));
    }, ms);
  };

  const armStartWatchdog = () => {
    armWatchdog(
      POOL_START_MS,
      `Asset pool start hang — no progress in ${POOL_START_MS / 1000}s (path=${MEDIA_POOL_PATH})`,
    );
  };

  const armStallWatchdog = () => {
    armWatchdog(
      POOL_STALL_MS,
      `Asset pool stall — no progress in ${POOL_STALL_MS / 1000}s (path=${MEDIA_POOL_PATH})`,
    );
  };

  const notePoolActivity = () => {
    if (!sawPoolActivity) {
      sawPoolActivity = true;
      console.info('[Perform6] Media asset pool first event — download active');
    }
    armStallWatchdog();
  };

  const bumpStallOnBytes = (fileName: string, bytes: number) => {
    if (fileName !== lastProgressFile) {
      lastProgressFile = fileName;
      lastProgressBytes = -1;
    }
    if (bytes <= lastProgressBytes) return;
    lastProgressBytes = bytes;
    notePoolActivity();
  };

  try {
    console.info('[Perform6] Media asset pool protectAssets…', {
      assets: assetList.length,
      pool: MEDIA_POOL_PATH,
    });
    try {
      await Promise.race([
        Promise.resolve(pool.protectAssets('perform6-media', assetList)),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(
              new Error(
                `Asset pool protectAssets hang — ${POOL_START_MS / 1000}s (path=${MEDIA_POOL_PATH})`,
              ),
            );
          }, POOL_START_MS);
        }),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('protectAssets hang')) throw e;
      console.warn('[Perform6] protectAssets failed (continuing fetch)', msg);
    }

    const onFile = (event: FileEvent) => {
      const name = String(event.filename ?? '');
      lastProgressFile = name;
      lastProgressBytes = -1;
      notePoolActivity();
      const item = byName.get(name);
      if (!item) return;
      const code = event.responseCode;
      const ok = code === 200 || code === 226 || code === 0;
      if (ok) {
        completedFiles += 1;
        if (item.fileSize != null && Number(item.fileSize) > 0) {
          batchBytesDownloaded += Number(item.fileSize);
        }
        void onProgress?.({
          mediaVersionId: item.mediaVersionId,
          bytesDownloaded:
            item.fileSize != null ? Number(item.fileSize) : 0,
          totalBytes: item.fileSize != null ? Number(item.fileSize) : null,
          status: 'done',
        });
      } else {
        failureReasons[item.mediaVersionId] =
          event.error || `Asset fetch failed (code ${String(code ?? '?')})`;
        void onProgress?.({
          mediaVersionId: item.mediaVersionId,
          bytesDownloaded: 0,
          totalBytes: item.fileSize != null ? Number(item.fileSize) : null,
          status: 'failed',
        });
      }
    };

    const onProgressEvent = (event: ProgressEvent) => {
      const name = String(event.filename ?? '');
      const item = byName.get(name);
      if (!item) return;
      const transferred = Number(event.currentFileTransferred ?? 0);
      const total =
        event.currentFileTotal != null
          ? Number(event.currentFileTotal)
          : item.fileSize != null
            ? Number(item.fileSize)
            : null;
      bumpStallOnBytes(name, transferred);
      updateUi(item, transferred, total, `${MEDIA_POOL_PATH}/${name}`);
      // Only report real movement (or first tick with transferred >= 0 after activity).
      if (transferred > 0) {
        void onProgress?.({
          mediaVersionId: item.mediaVersionId,
          bytesDownloaded: transferred,
          totalBytes: total,
          status: 'progress',
        });
      }
    };

    boundFileListener = onFile;
    boundProgressListener = onProgressEvent;
    runFetcher.addEventListener('fileevent', onFile);
    runFetcher.addEventListener('progressevent', onProgressEvent);

    console.info('[Perform6] Media asset pool fetch start', {
      total: items.length,
      needFetch: needFetch.length,
      already: already.length,
      pool: MEDIA_POOL_PATH,
      startTimeoutSec: POOL_START_MS / 1000,
    });

    const startPromise = runFetcher.start(needFetch);
    const stallPromise = new Promise<never>((_, reject) => {
      stallReject = reject;
      armStartWatchdog();
    });

    try {
      await Promise.race([startPromise, stallPromise]);
    } finally {
      clearStallTimer();
      stallReject = null;
    }

    for (const asset of needFetch) {
      const item = byName.get(asset.name)!;
      if (failureReasons[item.mediaVersionId]) {
        failed.push(item.mediaVersionId);
        clearSdCached([item.mediaVersionId]);
        continue;
      }
      const poolPath = await resolvePoolPath(assetList, asset.name);
      if (!poolPath) {
        failed.push(item.mediaVersionId);
        failureReasons[item.mediaVersionId] =
          'Asset pool fetch finished but path missing';
        clearSdCached([item.mediaVersionId]);
        continue;
      }
      markMediaPoolPath(item.mediaVersionId, poolPath);
      markSdCached(item.mediaVersionId, item.fileUrl);
      markSdDownloadConfirmed(item.mediaVersionId);
      succeeded.push(item.mediaVersionId);
      downloaded.push(item.mediaVersionId);
      emitSdCacheProgress({
        status: 'done',
        url: resolveMediaFileUrl(item.fileUrl),
        name: asset.name,
        mediaVersionId: item.mediaVersionId,
        destPath: poolPath,
        bytesDownloaded: item.fileSize != null ? Number(item.fileSize) : 0,
        bytesTotal: item.fileSize != null ? Number(item.fileSize) : undefined,
      });
    }
    emitSdCacheProgress({
      status: 'complete',
      doneCount: succeeded.length,
      totalCount: items.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[Perform6] Media asset pool fetch failed', msg);
    for (const asset of needFetch) {
      const item = byName.get(asset.name)!;
      if (succeeded.includes(item.mediaVersionId)) continue;
      if (!failed.includes(item.mediaVersionId)) failed.push(item.mediaVersionId);
      if (!failureReasons[item.mediaVersionId]) {
        failureReasons[item.mediaVersionId] = msg || 'Asset pool fetch failed';
      }
    }
  } finally {
    clearStallTimer();
    detachFetcherListeners(runFetcher);
    downloadInProgress = false;
    downloadStartedAtMs = 0;
    activeFetch = null;
    resetDownloadUiState();
  }

  return {
    succeeded: [...new Set(succeeded)],
    downloaded: [...new Set(downloaded)],
    failed: [...new Set(failed)].filter((id) => !succeeded.includes(id)),
    failureReasons,
  };
}

export function clearMediaAssetPoolMarks(mediaVersionIds?: string[]): void {
  clearMediaPoolPathMarks(mediaVersionIds);
}

export function mediaPoolFileUrl(mediaVersionId: string): string | null {
  const path = getMediaPoolPath(mediaVersionId);
  return path ? toFileUrl(path) : null;
}
