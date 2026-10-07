/**
 * BrightSign-safe physical media eviction.
 *
 * Order (playback-safe):
 * 1) Soft-stop display if the current src is being deleted
 * 2) Unlink realized .mp4 under perform6-media (with retries + per-file logs)
 * 3) clearSdCached / pool path marks ONLY for successful unlinks
 * 4) protectAssets(retain) so keep-set stays protected
 * 5) Delete corresponding unprotected pool hash objects (media-pool only)
 * 6) Sweep orphan .mp4 files not in the keep filename set
 *
 * Failed unlinks stay in a pending-evict list for the next sync retry.
 * Never touches perform6-ota-pool.
 */
import { getNodeFs, toNodeSdPath } from '../platform/brightSignNode';
import { useRuntimeStore } from '../stores/runtimeStore';
import type { SyncMediaItem } from '../shared/types/api';
import { resolveMediaFileUrl } from './manifest';
import {
  deleteUnprotectedMediaPoolAsset,
  deleteUnprotectedMediaPoolPath,
  isMediaAssetPoolDownloadInProgress,
  mediaItemToAsset,
  protectMediaPoolRetain,
  type MediaAsset,
} from './mediaAssetPool';
import { MEDIA_STORE_DIR_NAME, MEDIA_STORE_SD } from './mediaStorePaths';
import { offlineCacheService } from './offlineCache';
import { cacheNameFor } from './sdCacheName';
import {
  clearSdCached,
  getMediaPoolPath,
  getSdCachedUrl,
} from './sdCacheBridge';

const PENDING_EVICT_KEY = 'perform6-pending-evict-v1';
const PENDING_POOL_HASH_KEY = 'perform6-pending-pool-hash-v1';
const UNLINK_ATTEMPTS = 3;
const UNLINK_RETRY_MS = 350;

export interface PhysicalEvictResult {
  requested: number;
  unlinked: number;
  poolHashesDeleted: number;
  orphansSwept: number;
  pending: number;
  poolProtected: boolean;
  skippedPool: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function readPendingEvictIds(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_EVICT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];
  } catch {
    return [];
  }
}

function writePendingEvictIds(ids: string[]): void {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) {
    localStorage.removeItem(PENDING_EVICT_KEY);
    return;
  }
  localStorage.setItem(PENDING_EVICT_KEY, JSON.stringify(unique));
}

/** IDs that still need a successful .mp4 unlink (survives reboot via localStorage). */
export function loadPendingMediaEvictIds(): string[] {
  return readPendingEvictIds();
}

export function clearPendingMediaEvictIds(ids?: string[]): void {
  if (!ids?.length) {
    writePendingEvictIds([]);
    return;
  }
  const drop = new Set(ids);
  writePendingEvictIds(readPendingEvictIds().filter((id) => !drop.has(id)));
}

function readPendingPoolHashPaths(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_POOL_HASH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter((p): p is string => typeof p === 'string' && p.length > 0),
      ),
    ];
  } catch {
    return [];
  }
}

function writePendingPoolHashPaths(paths: string[]): void {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) {
    localStorage.removeItem(PENDING_POOL_HASH_KEY);
    return;
  }
  localStorage.setItem(PENDING_POOL_HASH_KEY, JSON.stringify(unique));
}

function addPendingPoolHashPaths(paths: string[]): void {
  writePendingPoolHashPaths([...readPendingPoolHashPaths(), ...paths]);
}

function fileNameForItem(item: SyncMediaItem): string | null {
  try {
    if (!item.fileUrl) return null;
    return cacheNameFor(resolveMediaFileUrl(item.fileUrl));
  } catch {
    return null;
  }
}

async function resolveFileUrlForId(
  mediaVersionId: string,
  known: Map<string, SyncMediaItem>,
): Promise<string | null> {
  const item = known.get(mediaVersionId);
  if (item?.fileUrl) return item.fileUrl;
  const marked = getSdCachedUrl(mediaVersionId);
  if (marked) return marked;
  const meta = await offlineCacheService.getMediaMeta(mediaVersionId);
  return meta?.url ?? null;
}

function softStopPlaybackIfReferencing(fileNames: Set<string>): void {
  if (fileNames.size === 0) return;
  try {
    const src = useRuntimeStore.getState().displayVideoSrc ?? '';
    const hit = [...fileNames].some(
      (name) => name && (src.includes(name) || src.endsWith(name)),
    );
    if (hit) {
      useRuntimeStore.getState().setDisplayVideoSrc(null);
      console.info('[Perform6] Evict soft-stopped display — src in delete set');
    }
  } catch {
    /* store may be unavailable in tests */
  }

  const fs = getNodeFs();
  if (!fs) return;
  for (const sd of [
    'SD:/perform6-led-playback.json',
    'SD:/perform6-xt-playback.json',
  ]) {
    try {
      const path = toNodeSdPath(sd);
      if (!fs.existsSync(path)) continue;
      const raw = String(fs.readFileSync(path, 'utf8') ?? '');
      const match = [...fileNames].some((name) => name && raw.includes(name));
      if (!match) continue;
      fs.unlinkSync(path);
      console.info('[Perform6] Evict cleared playback command file', { sd });
    } catch (e) {
      console.warn(
        '[Perform6] Evict playback command clear failed',
        sd,
        e instanceof Error ? e.message : e,
      );
    }
  }
}

function unlinkRealizedMp4Once(fileUrl: string): {
  ok: boolean;
  name: string;
  reason?: string;
} {
  const fs = getNodeFs();
  const name = cacheNameFor(resolveMediaFileUrl(fileUrl));
  if (!fs) return { ok: false, name, reason: 'fs-unavailable' };
  const nodePath = toNodeSdPath(`SD:/${MEDIA_STORE_DIR_NAME}/${name}`);
  try {
    if (!fs.existsSync(nodePath)) {
      return { ok: true, name, reason: 'already-absent' };
    }
    fs.unlinkSync(nodePath);
    return { ok: true, name };
  } catch (e) {
    return {
      ok: false,
      name,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

async function unlinkRealizedMp4WithRetry(fileUrl: string): Promise<{
  ok: boolean;
  name: string;
  attempts: number;
  reason?: string;
}> {
  let last = unlinkRealizedMp4Once(fileUrl);
  let attempts = 1;
  while (!last.ok && attempts < UNLINK_ATTEMPTS) {
    await sleep(UNLINK_RETRY_MS * attempts);
    last = unlinkRealizedMp4Once(fileUrl);
    attempts += 1;
  }
  return { ...last, attempts };
}

function buildRetainAssets(
  retainIdSet: Set<string>,
  known: Map<string, SyncMediaItem>,
): MediaAsset[] {
  const retainAssets: MediaAsset[] = [];
  const seenNames = new Set<string>();
  for (const id of retainIdSet) {
    try {
      const item = known.get(id);
      if (!item?.fileUrl) continue;
      const asset = mediaItemToAsset(item);
      if (seenNames.has(asset.name)) continue;
      seenNames.add(asset.name);
      retainAssets.push(asset);
    } catch {
      /* skip bad retain row */
    }
  }
  return retainAssets;
}

async function buildKeepFileNames(
  retainIdSet: Set<string>,
  known: Map<string, SyncMediaItem>,
): Promise<Set<string>> {
  const names = new Set<string>();
  for (const id of retainIdSet) {
    const item = known.get(id);
    if (item) {
      const n = fileNameForItem(item);
      if (n) names.add(n);
      continue;
    }
    const url = await resolveFileUrlForId(id, known);
    if (url) names.add(cacheNameFor(resolveMediaFileUrl(url)));
  }
  return names;
}

/**
 * Delete realized .mp4 files that are not in the keep filename set.
 * Does not touch pool hashes (those are handled via protect + hash delete).
 */
export async function sweepOrphanRealizedMedia(options: {
  retainItems: SyncMediaItem[];
  retainIds?: string[];
}): Promise<number> {
  const fs = getNodeFs();
  if (!fs) return 0;

  const known = new Map<string, SyncMediaItem>();
  for (const item of options.retainItems) {
    if (item?.mediaVersionId) known.set(item.mediaVersionId, item);
  }
  const retainIdSet = new Set<string>(
    (options.retainIds ?? []).filter(Boolean),
  );
  for (const item of options.retainItems) {
    if (item?.mediaVersionId) retainIdSet.add(item.mediaVersionId);
  }
  const keepNames = await buildKeepFileNames(retainIdSet, known);
  if (keepNames.size === 0) {
    console.warn(
      '[Perform6] Orphan media sweep skipped — empty keep set (refusing wipe)',
    );
    return 0;
  }

  const storePath = toNodeSdPath(MEDIA_STORE_SD);
  let swept = 0;
  try {
    if (!fs.existsSync(storePath)) return 0;
    const entries = fs.readdirSync(storePath) as string[];
    for (const name of entries) {
      if (!name || name.endsWith('.part')) continue;
      if (keepNames.has(name)) continue;
      const full = `${storePath.replace(/\/$/, '')}/${name}`;
      try {
        const st = fs.statSync(full);
        if (st.isDirectory()) continue;
        softStopPlaybackIfReferencing(new Set([name]));
        fs.unlinkSync(full);
        swept += 1;
        console.info('[Perform6] Orphan media swept', { name, ok: 1 });
      } catch (e) {
        console.warn(
          '[Perform6] Orphan media sweep failed',
          name,
          e instanceof Error ? e.message : e,
        );
      }
    }
  } catch (e) {
    console.warn(
      '[Perform6] Orphan media sweep listing failed',
      e instanceof Error ? e.message : e,
    );
  }

  if (swept > 0) {
    console.info('[Perform6] Orphan media sweep complete', {
      swept,
      keep: keepNames.size,
    });
  }
  return swept;
}

/**
 * Physical delete for weekly eviction. Best-effort — never throws.
 * Call BEFORE starting AssetPool download so Day-6 lead frees SD for next week.
 */
export async function physicallyEvictMedia(options: {
  evictIds: string[];
  /** Sync media list (download retain candidates) + any known items */
  retainItems: SyncMediaItem[];
  /** Server retain pin list (Default/Start Here + window) */
  retainIds?: string[];
}): Promise<PhysicalEvictResult> {
  const known = new Map<string, SyncMediaItem>();
  for (const item of options.retainItems) {
    if (item?.mediaVersionId) known.set(item.mediaVersionId, item);
  }

  // Keep-set first — never delete anything the server still wants.
  const retainIdSet = new Set<string>(
    (options.retainIds ?? []).filter(Boolean),
  );
  for (const item of options.retainItems) {
    if (item?.mediaVersionId) retainIdSet.add(item.mediaVersionId);
  }

  const requestedRaw = [
    ...new Set([...options.evictIds, ...readPendingEvictIds()].filter(Boolean)),
  ];
  // Pending IDs that are now retained: drop from pending, do not unlink.
  const rescued = requestedRaw.filter((id) => retainIdSet.has(id));
  if (rescued.length > 0) {
    clearPendingMediaEvictIds(rescued);
    console.info('[Perform6] Physical media evict — rescued retain IDs', {
      count: rescued.length,
    });
  }

  const evictIds = requestedRaw.filter((id) => !retainIdSet.has(id));
  if (evictIds.length === 0) {
    const orphansSwept =
      retainIdSet.size > 0
        ? await sweepOrphanRealizedMedia({
            retainItems: options.retainItems,
            retainIds: [...retainIdSet],
          })
        : 0;
    return {
      requested: 0,
      unlinked: 0,
      poolHashesDeleted: 0,
      orphansSwept,
      pending: readPendingEvictIds().length,
      poolProtected: false,
      skippedPool: true,
    };
  }

  // Capture pool-path hints BEFORE clearSdCached wipes them.
  const poolPathHints = new Map<string, string>();
  for (const id of evictIds) {
    const hint = getMediaPoolPath(id);
    if (hint) poolPathHints.set(id, hint);
  }

  // Pre-resolve filenames for soft-stop before deletes.
  const preNames = new Set<string>();
  for (const id of evictIds) {
    const url = await resolveFileUrlForId(id, known);
    if (url) preNames.add(cacheNameFor(resolveMediaFileUrl(url)));
  }
  softStopPlaybackIfReferencing(preNames);

  const succeededIds: string[] = [];
  const failedIds: string[] = [];
  /** id → asset (when hash/size known) for pool hash delete after protect */
  const succeededById = new Map<string, MediaAsset>();

  for (const id of evictIds) {
    try {
      const url = await resolveFileUrlForId(id, known);
      if (!url) {
        // Can't target a .mp4 without a URL; clear marks and let orphan sweep clean disk.
        succeededIds.push(id);
        console.warn('[Perform6] Physical media evict|unlink', {
          mediaVersionId: id,
          ok: 1,
          reason: 'url-unresolved-cleared',
        });
        continue;
      }
      const result = await unlinkRealizedMp4WithRetry(url);
      if (result.ok) {
        succeededIds.push(id);
        const item = known.get(id);
        if (item) {
          try {
            succeededById.set(id, mediaItemToAsset(item));
          } catch {
            /* hint-only hash delete may still work */
          }
        } else {
          // Evicted IDs are rarely in retainItems — rebuild asset from URL + meta.
          try {
            const meta = await offlineCacheService.getMediaMeta(id);
            succeededById.set(
              id,
              mediaItemToAsset({
                mediaVersionId: id,
                fileUrl: url,
                checksum: meta?.checksum,
                fileSize:
                  meta?.sizeBytes != null ? String(meta.sizeBytes) : null,
              }),
            );
          } catch {
            try {
              succeededById.set(
                id,
                mediaItemToAsset({ mediaVersionId: id, fileUrl: url }),
              );
            } catch {
              /* hint-only path */
            }
          }
        }
        console.info('[Perform6] Physical media evict|unlink', {
          mediaVersionId: id,
          file: result.name,
          ok: 1,
          attempts: result.attempts,
          detail: result.reason ?? 'deleted',
        });
      } else {
        failedIds.push(id);
        console.warn('[Perform6] Physical media evict|unlink', {
          mediaVersionId: id,
          file: result.name,
          ok: 0,
          attempts: result.attempts,
          reason: result.reason ?? 'unlink-failed',
        });
      }
    } catch (e) {
      failedIds.push(id);
      console.warn('[Perform6] Physical media evict|unlink', {
        mediaVersionId: id,
        ok: 0,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Marks only for successful unlinks — failures stay reportable / retryable.
  if (succeededIds.length > 0) {
    clearSdCached(succeededIds);
  }
  writePendingEvictIds(failedIds);

  const retainAssets = buildRetainAssets(retainIdSet, known);
  let poolProtected = false;
  let skippedPool = true;
  let poolHashesDeleted = 0;

  if (retainAssets.length > 0 && !isMediaAssetPoolDownloadInProgress()) {
    poolProtected = await protectMediaPoolRetain(retainAssets);
    skippedPool = !poolProtected;

    if (poolProtected && succeededIds.length > 0) {
      for (const id of succeededIds) {
        const asset = succeededById.get(id);
        const hint = poolPathHints.get(id) ?? null;
        let del: { ok: boolean; path: string | null; reason?: string };
        if (asset) {
          del = await deleteUnprotectedMediaPoolAsset(asset, hint);
        } else if (hint) {
          del = await deleteUnprotectedMediaPoolPath(hint);
        } else {
          console.warn('[Perform6] Physical media evict|pool-hash', {
            mediaVersionId: id,
            ok: 0,
            reason: 'no-asset-or-hint',
          });
          continue;
        }
        if (del.ok) {
          poolHashesDeleted += 1;
          console.info('[Perform6] Physical media evict|pool-hash', {
            mediaVersionId: id,
            name: asset?.name ?? null,
            ok: 1,
            path: del.path,
            detail: del.reason ?? 'deleted',
          });
        } else {
          if (del.path || hint) {
            addPendingPoolHashPaths([del.path ?? hint!]);
          }
          console.warn('[Perform6] Physical media evict|pool-hash', {
            mediaVersionId: id,
            name: asset?.name ?? null,
            ok: 0,
            path: del.path,
            reason: del.reason ?? 'delete-failed',
          });
        }
      }
    }

    // Retry pool hashes deferred from earlier runs (e.g. download was active).
    if (poolProtected) {
      const pendingPaths = readPendingPoolHashPaths();
      const stillPending: string[] = [];
      for (const path of pendingPaths) {
        const del = await deleteUnprotectedMediaPoolPath(path);
        if (del.ok) {
          poolHashesDeleted += 1;
          console.info('[Perform6] Physical media evict|pool-hash-retry', {
            ok: 1,
            path: del.path,
            detail: del.reason ?? 'deleted',
          });
        } else {
          stillPending.push(path);
          console.warn('[Perform6] Physical media evict|pool-hash-retry', {
            ok: 0,
            path: del.path ?? path,
            reason: del.reason ?? 'delete-failed',
          });
        }
      }
      writePendingPoolHashPaths(stillPending);
    }
  } else if (retainAssets.length === 0) {
    console.warn(
      '[Perform6] Physical media evict — pool protect skipped (empty retain)',
    );
  } else {
    // Defer hash deletes until fetch finishes — keep hints for retry.
    const deferred = succeededIds
      .map((id) => poolPathHints.get(id))
      .filter((p): p is string => Boolean(p));
    if (deferred.length > 0) {
      addPendingPoolHashPaths(deferred);
      console.info(
        '[Perform6] Physical media evict — pool hash delete deferred (download in progress)',
        { count: deferred.length },
      );
    } else {
      console.info(
        '[Perform6] Physical media evict — pool protect deferred (download in progress)',
      );
    }
  }

  const orphansSwept = await sweepOrphanRealizedMedia({
    retainItems: options.retainItems,
    retainIds: [...retainIdSet],
  });

  console.info('[Perform6] Physical media evict', {
    requested: evictIds.length,
    unlinked: succeededIds.length,
    failed: failedIds.length,
    poolHashesDeleted,
    orphansSwept,
    pending: failedIds.length,
    retainAssets: retainAssets.length,
    poolProtected,
  });

  return {
    requested: evictIds.length,
    unlinked: succeededIds.length,
    poolHashesDeleted,
    orphansSwept,
    pending: failedIds.length,
    poolProtected,
    skippedPool,
  };
}
