/**
 * BrightSign-safe physical media eviction.
 * - Unlink realized playable files under perform6-media/
 * - protectAssets(retain) on perform6-media-pool (unprotects evicted pool objects)
 * Does not touch OTA pool, download fetchers, or encryption key staging.
 */
import { getNodeFs, toNodeSdPath } from '../platform/brightSignNode';
import type { SyncMediaItem } from '../shared/types/api';
import { resolveMediaFileUrl } from './manifest';
import {
  mediaItemToAsset,
  protectMediaPoolRetain,
  type MediaAsset,
} from './mediaAssetPool';
import { MEDIA_STORE_DIR_NAME } from './mediaStorePaths';
import { offlineCacheService } from './offlineCache';
import { cacheNameFor } from './sdCacheName';
import {
  clearSdCached,
  getSdCachedUrl,
} from './sdCacheBridge';

export interface PhysicalEvictResult {
  unlinked: number;
  poolProtected: boolean;
  skippedPool: boolean;
}

function unlinkRealizedMp4(fileUrl: string): boolean {
  const fs = getNodeFs();
  if (!fs) return false;
  const name = cacheNameFor(resolveMediaFileUrl(fileUrl));
  const nodePath = toNodeSdPath(`SD:/${MEDIA_STORE_DIR_NAME}/${name}`);
  try {
    if (fs.existsSync(nodePath)) {
      fs.unlinkSync(nodePath);
      return true;
    }
  } catch (e) {
    console.warn(
      '[Perform6] Evict unlink failed',
      name,
      e instanceof Error ? e.message : e,
    );
  }
  return false;
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
  const evictIds = [...new Set(options.evictIds.filter(Boolean))];
  if (evictIds.length === 0) {
    return { unlinked: 0, poolProtected: false, skippedPool: true };
  }

  const evictSet = new Set(evictIds);
  const known = new Map<string, SyncMediaItem>();
  for (const item of options.retainItems) {
    if (item?.mediaVersionId) known.set(item.mediaVersionId, item);
  }

  let unlinked = 0;
  for (const id of evictIds) {
    try {
      const url = await resolveFileUrlForId(id, known);
      if (url && unlinkRealizedMp4(url)) unlinked += 1;
    } catch {
      /* best-effort */
    }
  }

  // Build retain asset list for BrightSign protectAssets (must be non-empty).
  const retainIdSet = new Set<string>(
    (options.retainIds ?? []).filter((id) => id && !evictSet.has(id)),
  );
  for (const item of options.retainItems) {
    if (item?.mediaVersionId && !evictSet.has(item.mediaVersionId)) {
      retainIdSet.add(item.mediaVersionId);
    }
  }

  const retainAssets: MediaAsset[] = [];
  const seenNames = new Set<string>();
  for (const id of retainIdSet) {
    try {
      let item = known.get(id);
      if (!item?.fileUrl) {
        const url = await resolveFileUrlForId(id, known);
        if (!url) continue;
        item = {
          mediaVersionId: id,
          fileUrl: url,
        };
      }
      const asset = mediaItemToAsset(item);
      if (seenNames.has(asset.name)) continue;
      seenNames.add(asset.name);
      retainAssets.push(asset);
    } catch {
      /* skip bad retain row */
    }
  }

  const poolProtected = await protectMediaPoolRetain(retainAssets);

  // Marks after physical ops so Admin/cache reconcile matches disk.
  clearSdCached(evictIds);

  console.info('[Perform6] Physical media evict', {
    evict: evictIds.length,
    unlinked,
    retainAssets: retainAssets.length,
    poolProtected,
  });

  return {
    unlinked,
    poolProtected,
    skippedPool: !poolProtected,
  };
}
