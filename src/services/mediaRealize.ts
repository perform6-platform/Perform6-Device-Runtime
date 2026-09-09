/**
 * BrightSign AssetRealizer → /storage/sd/perform6-media
 * Field EPERM: Node fs.copyFileSync cannot copy AssetPool sha256 blobs.
 * Docs: realize copies by asset name into a filesystem directory (needed for PlayFile).
 */
import type { SyncMediaItem } from '../shared/types/api';
import { getNodeFs, toNodeSdPath } from '../platform/brightSignNode';
import { MEDIA_ASSET_POOL_DIR, MEDIA_ASSET_POOL_DIR_DOCS } from './brightSignPoolPath';
import { MEDIA_STORE_DIR_NAME } from './mediaStorePaths';
import { resolveMediaFileUrl } from './manifest';
import { cacheNameFor } from './sdCacheName';
import {
  emitSdCacheProgress,
  markSdCached,
  markSdDownloadConfirmed,
} from './sdCacheBridge';
import { mediaItemToAsset, type MediaAsset } from './mediaAssetPool';

type BrightSignRequire = (id: string) => unknown;

type AssetPoolInstance = {
  protectAssets?: (name: string, list: MediaAsset[]) => Promise<void> | void;
};

type AssetRealizerInstance = {
  realize: (
    a: string | MediaAsset[],
    b?: MediaAsset[] | string,
  ) => Promise<void> | void;
};

type AssetPoolCtor = new (path: string) => AssetPoolInstance;
type AssetRealizerCtorA = new (pool: AssetPoolInstance) => AssetRealizerInstance;
type AssetRealizerCtorB = new (
  pool: AssetPoolInstance,
  destPath: string,
) => AssetRealizerInstance;

const MEDIA_STORE_NODE = `/storage/sd/${MEDIA_STORE_DIR_NAME}`;

function getRequire(): BrightSignRequire | null {
  const g = globalThis as unknown as { require?: BrightSignRequire };
  if (typeof g.require === 'function') return g.require;
  if (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { require?: BrightSignRequire }).require === 'function'
  ) {
    return (window as unknown as { require: BrightSignRequire }).require;
  }
  return null;
}

function ensureMediaStoreDir(): void {
  const fs = getNodeFs();
  if (!fs) return;
  try {
    if (!fs.existsSync(MEDIA_STORE_NODE)) {
      fs.mkdirSync(MEDIA_STORE_NODE, { recursive: true });
    }
  } catch (e) {
    console.warn(
      '[Perform6] media store mkdir failed',
      e instanceof Error ? e.message : e,
    );
  }
}

function mediaFileExists(fileName: string): boolean {
  const fs = getNodeFs();
  if (!fs) return false;
  const path = `${MEDIA_STORE_NODE}/${fileName}`;
  try {
    return fs.existsSync(path) && fs.statSync(path).size > 0;
  } catch {
    return false;
  }
}

async function getPoolAndRealizer(): Promise<{
  pool: AssetPoolInstance;
  RealizerClass: AssetRealizerCtorA | AssetRealizerCtorB;
} | null> {
  const req = getRequire();
  if (!req) return null;
  let PoolClass: AssetPoolCtor;
  let RealizerClass: AssetRealizerCtorA | AssetRealizerCtorB;
  try {
    PoolClass = req('@brightsign/assetpool') as AssetPoolCtor;
    RealizerClass = req('@brightsign/assetrealizer') as
      | AssetRealizerCtorA
      | AssetRealizerCtorB;
  } catch (e) {
    console.warn(
      '[Perform6] AssetRealizer module unavailable',
      e instanceof Error ? e.message : e,
    );
    return null;
  }

  for (const path of [MEDIA_ASSET_POOL_DIR, MEDIA_ASSET_POOL_DIR_DOCS]) {
    try {
      const pool = new PoolClass(path);
      return { pool, RealizerClass };
    } catch {
      /* try next */
    }
  }
  return null;
}

async function callRealize(
  RealizerClass: AssetRealizerCtorA | AssetRealizerCtorB,
  pool: AssetPoolInstance,
  assets: MediaAsset[],
): Promise<void> {
  // Docs variant A: new AssetRealizer(pool, dest); realize(collection)
  try {
    const realizer = new (RealizerClass as AssetRealizerCtorB)(
      pool,
      MEDIA_STORE_NODE,
    );
    await Promise.resolve(realizer.realize(assets));
    return;
  } catch (e1) {
    console.warn(
      '[Perform6] AssetRealizer(pool, dest) failed — trying realize(dest, list)',
      e1 instanceof Error ? e1.message : e1,
    );
  }
  // Docs variant B: new AssetRealizer(pool); realize(dest, collection)
  const realizer = new (RealizerClass as AssetRealizerCtorA)(pool);
  try {
    await Promise.resolve(realizer.realize(MEDIA_STORE_NODE, assets));
  } catch {
    await Promise.resolve(realizer.realize(assets, MEDIA_STORE_NODE));
  }
}

/**
 * Copy pool assets into perform6-media using BrightSign AssetRealizer (not Node copyFile).
 */
export async function realizeMediaAssetsViaRealizer(
  items: SyncMediaItem[],
): Promise<{
  succeeded: string[];
  failed: string[];
  failureReasons: Record<string, string>;
}> {
  const succeeded: string[] = [];
  const failed: string[] = [];
  const failureReasons: Record<string, string> = {};

  if (items.length === 0) {
    return { succeeded, failed, failureReasons };
  }

  ensureMediaStoreDir();

  const alreadyReady: SyncMediaItem[] = [];
  const needRealize: SyncMediaItem[] = [];
  for (const item of items) {
    const name = cacheNameFor(resolveMediaFileUrl(item.fileUrl));
    if (mediaFileExists(name)) {
      markSdCached(item.mediaVersionId, item.fileUrl);
      markSdDownloadConfirmed(item.mediaVersionId);
      emitSdCacheProgress({
        status: 'skip',
        url: resolveMediaFileUrl(item.fileUrl),
        name,
        mediaVersionId: item.mediaVersionId,
        destPath: `${MEDIA_STORE_NODE}/${name}`,
        bytesDownloaded: item.fileSize != null ? Number(item.fileSize) : 0,
        bytesTotal: item.fileSize != null ? Number(item.fileSize) : undefined,
      });
      alreadyReady.push(item);
      succeeded.push(item.mediaVersionId);
    } else {
      needRealize.push(item);
    }
  }

  if (needRealize.length === 0) {
    return { succeeded, failed, failureReasons };
  }

  const loaded = await getPoolAndRealizer();
  if (!loaded) {
    for (const item of needRealize) {
      failed.push(item.mediaVersionId);
      failureReasons[item.mediaVersionId] =
        'AssetRealizer unavailable — use autorun media download';
    }
    return { succeeded, failed, failureReasons };
  }

  const assets = needRealize.map(mediaItemToAsset);
  try {
    console.info('[Perform6] AssetRealizer → perform6-media', {
      count: assets.length,
      dest: MEDIA_STORE_NODE,
    });
    await callRealize(loaded.RealizerClass, loaded.pool, assets);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[Perform6] AssetRealizer failed', msg);
    for (const item of needRealize) {
      failed.push(item.mediaVersionId);
      failureReasons[item.mediaVersionId] = `AssetRealizer failed: ${msg}`;
    }
    return { succeeded, failed, failureReasons };
  }

  for (const item of needRealize) {
    const name = cacheNameFor(resolveMediaFileUrl(item.fileUrl));
    if (mediaFileExists(name)) {
      markSdCached(item.mediaVersionId, item.fileUrl);
      markSdDownloadConfirmed(item.mediaVersionId);
      emitSdCacheProgress({
        status: 'done',
        url: resolveMediaFileUrl(item.fileUrl),
        name,
        mediaVersionId: item.mediaVersionId,
        destPath: `${MEDIA_STORE_NODE}/${name}`,
        bytesDownloaded: item.fileSize != null ? Number(item.fileSize) : 0,
        bytesTotal: item.fileSize != null ? Number(item.fileSize) : undefined,
      });
      succeeded.push(item.mediaVersionId);
      console.info('[Perform6] Pool→media realized (AssetRealizer)', {
        mediaVersionId: item.mediaVersionId,
        file: name,
        path: toNodeSdPath(`SD:/${MEDIA_STORE_DIR_NAME}/${name}`),
      });
    } else {
      failed.push(item.mediaVersionId);
      failureReasons[item.mediaVersionId] =
        'AssetRealizer finished but perform6-media file missing';
    }
  }

  return {
    succeeded: [...new Set(succeeded)],
    failed: [...new Set(failed)].filter((id) => !succeeded.includes(id)),
    failureReasons,
  };
}
