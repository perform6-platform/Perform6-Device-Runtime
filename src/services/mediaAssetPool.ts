/**
 * BrightSign asset-pool media delivery (separate from OTA).
 * Pool: SD:/perform6-media-pool — never shares OTA package files on SD:/.
 */
import type { SyncMediaItem } from '../shared/types/api';
import { resolveMediaFileUrl } from './manifest';
import { cacheNameFor } from './sdCacheName';
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

export const MEDIA_POOL_PATH = 'SD:/perform6-media-pool';

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
let activeFetch: AssetPoolFetcherInstance | null = null;
let modulesLoaded = false;
let modulesAvailable = false;
let AssetPoolFilesClass: AssetPoolFilesCtor | null = null;
let downloadInProgress = false;

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
  if (modulesLoaded) return modulesAvailable;
  modulesLoaded = true;

  const probe = probeBrightSignAssetPool();
  if (!probe.assetpool || !probe.assetpoolfetcher) {
    modulesAvailable = false;
    console.info('[Perform6] Media asset pool unavailable', probe);
    return false;
  }

  const req = getRequire();
  if (!req) {
    modulesAvailable = false;
    return false;
  }

  try {
    const PoolClass = req('@brightsign/assetpool') as AssetPoolCtor;
    const FetcherClass = req('@brightsign/assetpoolfetcher') as AssetPoolFetcherCtor;
    pool = new PoolClass(MEDIA_POOL_PATH);
    fetcher = new FetcherClass(pool);

    try {
      AssetPoolFilesClass = req('@brightsign/assetpoolfiles') as AssetPoolFilesCtor;
    } catch {
      try {
        AssetPoolFilesClass = req('@brightsign/assetfiles') as AssetPoolFilesCtor;
      } catch {
        AssetPoolFilesClass = null;
      }
    }

    modulesAvailable = true;
    console.info('[Perform6] Media asset pool ready', { path: MEDIA_POOL_PATH });
  } catch (e) {
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
  return downloadInProgress;
}

export function getMediaPoolPlaybackPath(mediaVersionId: string): string | null {
  return getMediaPoolPath(mediaVersionId);
}

export function clearMediaPoolPlaybackPaths(mediaVersionIds?: string[]): void {
  clearMediaPoolPathMarks(mediaVersionIds);
}

function toFileUrl(sdPath: string): string {
  if (sdPath.startsWith('file://')) return sdPath;
  if (sdPath.startsWith('SD:/') || sdPath.startsWith('sd:/')) {
    return `file:///${sdPath.replace(/^sd:/i, 'SD:')}`;
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

  downloadInProgress = true;
  activeFetch = fetcher;

  const byName = new Map<string, SyncMediaItem>();
  const assetList: MediaAsset[] = [];
  for (const item of items) {
    const asset = mediaItemToAsset(item);
    byName.set(asset.name, item);
    assetList.push(asset);
  }

  const already: SyncMediaItem[] = [];
  const needFetch: MediaAsset[] = [];

  for (const asset of assetList) {
    const item = byName.get(asset.name)!;
    const existing = getMediaPoolPath(item.mediaVersionId);
    if (existing) {
      already.push(item);
      succeeded.push(item.mediaVersionId);
      continue;
    }
    needFetch.push(asset);
  }

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

  if (already.length === items.length) {
    downloadInProgress = false;
    activeFetch = null;
    resetDownloadUiState();
    return { succeeded, downloaded, failed, failureReasons };
  }

  updateUi(byName.get(needFetch[0]?.name ?? '') ?? null, 0, null, MEDIA_POOL_PATH);

  try {
    try {
      await Promise.resolve(pool.protectAssets('perform6-media', assetList));
    } catch (e) {
      console.warn(
        '[Perform6] protectAssets failed (continuing fetch)',
        e instanceof Error ? e.message : e,
      );
    }

    const onFile = (event: FileEvent) => {
      const name = String(event.filename ?? '');
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
      updateUi(item, transferred, total, `${MEDIA_POOL_PATH}/${name}`);
      void onProgress?.({
        mediaVersionId: item.mediaVersionId,
        bytesDownloaded: transferred,
        totalBytes: total,
        status: 'progress',
      });
    };

    fetcher.addEventListener('fileevent', onFile);
    fetcher.addEventListener('progressevent', onProgressEvent);

    console.info('[Perform6] Media asset pool fetch start', {
      total: items.length,
      needFetch: needFetch.length,
      already: already.length,
      pool: MEDIA_POOL_PATH,
    });

    await fetcher.start(needFetch);

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
    downloadInProgress = false;
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
